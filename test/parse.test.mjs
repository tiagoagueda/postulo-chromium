// Runs with `node --test`: the page reader, on pages parsed by jsdom as a browser would.
import assert from "node:assert/strict";
import { test } from "node:test";

import { JSDOM } from "jsdom";

import { MAX_PAGE, emptyPosting, jsonLd, metadata, readPosting, readPostings, slimPage, textOf, tidy } from "../src/lib/parse.js";

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

test("a posting whose script states its address and markup does not is listed once, under a tracking query", () => {
  const markup =
    '<div itemscope itemtype="https://schema.org/JobPosting"><span itemprop="title">Research Engineer</span></div>';
  const doc = page(ld({ ...POSTING, url: URL_ }), markup);
  const listed = readPostings(doc, `${URL_}?utm_source=newsletter`, parse);
  assert.equal(listed.length, 1);
  assert.ok(listed[0].here);
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

test("a listed posting stating an address on another site is marked, with its host, and read as this page's", () => {
  const listing = (title, url) => ({ "@type": "JobPosting", title, url });
  const doc = page(`<title>Jobs</title>${ld([listing("Welder", "https://www.a.example/jobs/1"), listing("Guard", "https://b.example/jobs/2")])}`);
  const listed = readPostings(doc, "https://a.example/jobs", parse);
  const [welder, guard] = listed;
  assert.equal(welder.elsewhere, false);
  assert.equal(guard.elsewhere, true);
  assert.equal(guard.host, "b.example");
  assert.equal(guard.data.source, "a.example");
  assert.equal(guard.data.url, "https://b.example/jobs/2");
});

test("a kept page holds no hidden field, token meta tag, input value or comment, and reads the same", () => {
  const doc = page(
    `<title>Research Engineer</title><meta name="csrf-token" content="SECRET-META"><meta name="description" content="kept">${ld(POSTING)}<!-- SECRET-COMMENT -->`,
    '<form><input type="hidden" name="t" value="SECRET-HIDDEN"><input type="PASSWORD" value="SECRET-PASS"><input type="text" value="SECRET-VALUE"><button value="SECRET-BUTTON">Go</button></form>',
  );
  const slim = slimPage(doc);
  assert.doesNotMatch(slim, /SECRET/);
  assert.ok(slim.includes('name="description"'));
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

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])/;

test("a field cut inside an emoji does not keep half of it", () => {
  const tidied = tidy({ ...emptyPosting(URL_), title: `${"a".repeat(499)}\u{1f680}`, description: "x" });
  assert.equal(tidied.title, "a".repeat(499));
  assert.doesNotMatch(tidied.title, LONE_SURROGATE);
});

test("a page cut inside an emoji does not keep half of it", () => {
  // Whichever parity the page head has, one of the two pads puts the cut inside the pair.
  for (const pad of ["", "a"]) {
    const doc = page("<title>T</title>", `<p>${pad}${"\u{1f680}".repeat(MAX_PAGE / 2)}</p>`);
    const slim = slimPage(doc);
    assert.doesNotMatch(slim, LONE_SURROGATE);
  }
});

test("an address over the limit is left out, not cut to a prefix that leads nowhere", () => {
  const long = `https://jobs.example/search?q=${"a".repeat(600)}`;
  assert.equal(tidy({ title: "T", description: "", url: long }).url, "");
  assert.equal(tidy({ title: "T", description: "", url: "https://jobs.example/1" }).url, "https://jobs.example/1");
});

const SITE = "https://careers.blackmesa.example";
const sitePostings = ["Welder", "Physicist", "Guard"].map((title, i) => ({
  ...POSTING,
  title,
  url: `${SITE}/jobs/${(i + 1) * 1001}`,
  identifier: { "@type": "PropertyValue", name: "BlackMesa", value: String((i + 1) * 1001) },
}));

test("an identifier's issuer is not its id: the posting naming the page wins", () => {
  const doc = page(ld(sitePostings));
  assert.equal(readPosting(doc, `${SITE}/jobs/2002`, parse).data.title, "Physicist");
  assert.equal(readPosting(doc, `${SITE}/jobs/2002?utm_source=x`, parse).data.title, "Physicist");
});

test("a results page naming no posting marks none as the page's", () => {
  const listed = readPostings(page(ld(sitePostings)), `${SITE}/jobs?q=all`, parse);
  assert.equal(listed.length, 3);
  assert.ok(listed.every((posting) => !posting.here));
});

test("an identifier matches a whole segment of the address, not part of one", () => {
  const doc = page(ld(sitePostings.map(({ url, ...rest }) => rest)));
  assert.equal(readPosting(doc, `${SITE}/jobs/2002`, parse).data.title, "Physicist");
  assert.equal(readPosting(doc, `${SITE}/jobs/20020`, parse).data.title, "Welder");
});

test("a page that draws its posting in an open shadow root keeps it, slimmed like the rest (#30)", () => {
  const doc = page(
    "<title>Offre</title>",
    `<descriptif-offre><template shadowrootmode="open"><style>x{}</style><h1>Welder</h1><input type="hidden" value="SECRET-HIDDEN"><!-- SECRET-COMMENT --><script>big()</script><p>Weld things</p></template></descriptif-offre><template><p>an ordinary template</p></template>`,
  );
  const slim = slimPage(doc);
  assert.ok(slim.includes('shadowrootmode="open"') && slim.includes("<h1>Welder</h1>") && slim.includes("Weld things"));
  assert.doesNotMatch(slim, /SECRET|big\(\)|<style|ordinary template/);
});
