// Runs with `node --test`: the page reader, on pages parsed by jsdom as a browser would.
import assert from "node:assert/strict";
import { test } from "node:test";

import { JSDOM } from "jsdom";

import { MAX_PAGE, jsonLd, metadata, readPosting, readPostings, slimPage, textOf } from "../src/lib/parse.js";

const parse = (html) => new JSDOM(html).window.document;
const page = (head, body = "") => parse(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`);
const ld = (object) => `<script type="application/ld+json">${JSON.stringify(object)}</script>`;
const URL_ = "https://jobs.example.org/42";

const POSTING = {
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  title: "Research Engineer",
  hiringOrganization: { "@type": "Organization", name: "Black Mesa" },
  jobLocation: { "@type": "Place", address: { addressLocality: "Issy-les-Moulineaux, FR", addressCountry: "FR" } },
  employmentType: ["FULL_TIME"],
  jobLocationType: "TELECOMMUTE",
  baseSalary: {
    "@type": "MonetaryAmount",
    currency: "eur",
    value: { "@type": "QuantitativeValue", minValue: 55000, maxValue: "65000.50", unitText: "YEAR" },
  },
  datePosted: "2026-09-01T09:00:00+02:00",
  validThrough: "2026-10-31",
  description: "&lt;p&gt;Anomalous materials.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Hard hats&lt;/li&gt;&lt;/ul&gt;",
};

test("a posting written twice, in the script and in the markup, is listed once", () => {
  const markup =
    '<div itemscope itemtype="https://schema.org/JobPosting"><span itemprop="title">Research Engineer</span>' +
    '<meta itemprop="url" content="https://jobs.example.org/42"></div>';
  const doc = page(ld({ ...POSTING, url: URL_ }), markup);
  const listed = readPostings(doc, URL_, parse);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].data.url, URL_);
  assert.ok(listed[0].here, "and it is this page's");
  assert.equal(readPostings(page(""), URL_, parse).length, 0);
});

test("a schema.org JobPosting is read into every field Postulo has", () => {
  const read = readPosting(page(ld(POSTING)), URL_, parse);
  assert.equal(read.source, "schema.org");
  assert.deepEqual(read.data, {
    title: "Research Engineer",
    company_name: "Black Mesa",
    location: "Issy-les-Moulineaux, FR",
    remote_type: "remote",
    employment_type: "full_time",
    description: "Anomalous materials.\n\nHard hats",
    salary_min: "55000",
    salary_max: "65000.50",
    salary_currency: "EUR",
    salary_period: "year",
    posted_at: "2026-09-01",
    closes_at: "2026-10-31",
    url: URL_,
    source: "jobs.example.org",
  });
});

test("JSON-LD comes as one object, a list, or an @graph, and a broken block spoils nothing", () => {
  const doc = page(
    '<script type="application/ld+json">{ not json</script>' +
      ld([{ "@type": "WebSite" }, { "@graph": [{ "@type": ["Thing", "JobPosting"], title: "In a graph" }] }]),
  );
  assert.equal(jsonLd(doc).length, 3);
  assert.equal(readPosting(doc, URL_, parse).data.title, "In a graph");
});

test("what cannot be determined is left empty, never guessed", () => {
  const read = readPosting(
    page(ld({ "@type": "JobPosting", title: "Just a title", baseSalary: { value: "competitive" }, validThrough: "soon" })),
    URL_,
    parse,
  );
  assert.equal(read.data.salary_min, null);
  assert.equal(read.data.closes_at, null);
  assert.equal(read.data.company_name, "");
  assert.equal(read.data.employment_type, "");
});

test("a place is said once, and a genuine repetition is kept", () => {
  const where = (address) => readPosting(page(ld({ "@type": "JobPosting", title: "T", jobLocation: { address } })), URL_, parse).data.location;
  assert.equal(where({ addressLocality: "New York", addressRegion: "York" }), "New York, York");
  assert.equal(where({ addressLocality: "Lyon", addressCountry: { name: "France" } }), "Lyon, France");
  assert.equal(where("12 Rue de la Paix, Paris"), "12 Rue de la Paix, Paris");
});

test("with no structured data, the declared title and the page's text are taken", () => {
  const doc = page(
    '<title>Plain title</title><meta property="og:title" content="Senior Plumber"><meta property="og:site_name" content="Jobs &amp; Co">' +
      "<style>p { color: red }</style>",
    "<nav>Menu</nav><h1>Senior Plumber</h1><p>Pipes,   mostly.</p><script>track()</script><p>Apply now.</p>",
  );
  const read = readPosting(doc, URL_, parse);
  assert.equal(read.source, "page-metadata");
  assert.equal(read.data.title, "Senior Plumber");
  assert.equal(read.data.company_name, "Jobs & Co");
  // The <nav> is the page's furniture, not the advert, and the page said so itself.
  assert.equal(read.data.description, "Senior Plumber\n\nPipes, mostly.\n\nApply now.");
});

test("a JobPosting without a title falls through to the page's own", () => {
  const read = readPosting(page(`<title>From the page</title>${ld({ "@type": "JobPosting", title: " " })}`), URL_, parse);
  assert.equal(read.source, "page-metadata");
  assert.equal(read.data.title, "From the page");
});

test("a page that declares nothing reads as nothing", () => {
  assert.equal(readPosting(page("", "<p>Hello</p>"), URL_, parse), null);
});

test("fields are cut to what Postulo would accept, not refused", () => {
  const read = readPosting(page(ld({ "@type": "JobPosting", title: "T".repeat(600), description: "x".repeat(50_000) })), URL_, parse);
  assert.equal(read.data.title.length, 500);
  assert.ok(read.data.description.endsWith("\n\n[…truncated]"));
  assert.equal(read.data.description.length, 40_000 + "\n\n[…truncated]".length);
});

test("the first of each meta tag wins, and the title is the page's", () => {
  const meta = metadata(page('<title> The title </title><meta name="description" content="one"><meta name="description" content="two">'));
  assert.deepEqual(meta, { title: "The title", description: "one" });
});

test("text keeps paragraphs apart and nothing a reader does not see", () => {
  const doc = page("", "<div>One<br>Two</div><template><p>hidden</p></template><svg><text>chart</text></svg><p>Three</p>");
  assert.equal(textOf(doc.body), "One\nTwo\n\nThree");
});

test("the page kept is lighter but reads the same", () => {
  const doc = page(
    `<title>Research Engineer</title><link rel="stylesheet" href="a.css"><style>x{}</style>${ld(POSTING)}<script src="app.js"></script>`,
    "<svg><path d='M0 0'/></svg><p>Body</p><script>big()</script>",
  );
  const slim = slimPage(doc);
  assert.ok(!slim.includes("app.js") && !slim.includes("big()") && !slim.includes("<style") && !slim.includes("<svg"));
  assert.ok(slim.includes("application/ld+json") && slim.includes("<title>Research Engineer</title>"));
  const again = new JSDOM(slim).window.document;
  assert.deepEqual(readPosting(again, URL_, parse), readPosting(doc, URL_, parse));
});

test("a page too big to keep is cut, and what it declared survives the cut", () => {
  const doc = page(`<title>Research Engineer</title>${ld(POSTING)}`, `<p>${"filler ".repeat(MAX_PAGE / 4)}</p>`);
  const slim = slimPage(doc);
  assert.ok(slim.length > MAX_PAGE, "the note says what happened");
  assert.ok(slim.length < MAX_PAGE + 200, "and nothing else is kept");
  assert.match(slim, /truncated at \d+ characters/);
  // The posting is declared in the head, so it is still read out of what was kept.
  const again = new JSDOM(slim).window.document;
  assert.deepEqual(readPosting(again, URL_, parse), readPosting(doc, URL_, parse));
});
