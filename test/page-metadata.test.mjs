// Runs with `node --test`: the fallback for a page with no structured data -- the title line
// split into job and employer, and the pay and closing date read after their words. The
// cases mirror Postulo's own (tests/test_page_metadata.py), so the two agree on a page.
import assert from "node:assert/strict";
import { test } from "node:test";

import { JSDOM } from "jsdom";

import { readPosting } from "../src/lib/parse.js";
import { closingDate, figure, order, salary, tagOf } from "../src/lib/patterns.js";
import { employer, isSite, readTitles, split } from "../src/lib/titles.js";

const parse = (html) => new JSDOM(html).window.document;
const URL_ = "https://jobs.example.org/openings/42";
const read = (html, url = URL_) => readPosting(parse(html), url, parse).data;
const BLURB = "<p>Aperture Science builds the chambers others only fall through.</p>";
const pay = (data) => [data.salary_min, data.salary_max, data.salary_currency, data.salary_period];

// ------------------------------------------------------------------ the title line

test("the heading names the job and 'at' names the employer", () => {
  const data = read(
    `<html lang="en"><head><title>Senior Plumber at Black Mesa - Lisbon | Jobs Portal</title></head>
     <body><main><h1>Senior Plumber</h1>${BLURB}</main></body></html>`,
  );
  assert.equal(data.title, "Senior Plumber");
  assert.equal(data.company_name, "Black Mesa");
  assert.equal(data.location, "", "the extension has no table of cities to vouch for a place");
});

test("with no single heading the job is the part left over, and the site is the employer on its own site", () => {
  const data = read(
    `<html lang="en"><head><title>Careers</title>
     <meta property="og:title" content="Test Chamber Engineer – Lisbon – Aperture Science" />
     <meta property="og:site_name" content="Aperture Science" /></head>
     <body><main><h1>Careers at Aperture Science</h1><h1>Test Chamber Engineer</h1>${BLURB}</main></body></html>`,
    "https://careers.aperture.example/jobs/7",
  );
  assert.equal(data.title, "Test Chamber Engineer – Lisbon", "nothing vouches for Lisbon here, so it stays");
  assert.equal(data.company_name, "Aperture Science");
});

test("a part nothing vouches for is left alone", () => {
  const data = read(
    `<html lang="en"><head><title>Test Chamber Engineer - Aperture Science - Remote</title></head>
     <body><main><h1>Test Chamber Engineer</h1>${BLURB}</main></body></html>`,
  );
  assert.equal(data.title, "Test Chamber Engineer");
  assert.equal(data.company_name, "", "one of two parts, and nothing says which");
});

test("a page drawn by a script is read from what it declares", () => {
  const data = read(
    `<html lang="en"><head><title>Aperture Science</title>
     <meta name="twitter:title" content="Test Chamber Engineer | Aperture Science" />
     <meta property="og:site_name" content="Aperture Science" /></head>
     <body><div id="app">Loading…</div></body></html>`,
    "https://careers.aperture.example/jobs/7",
  );
  assert.equal(data.title, "Test Chamber Engineer", "from twitter:title, less the site's name");
  assert.equal(data.company_name, "Aperture Science");
});

test("the employer after 'at' is read only after the job", () => {
  assert.equal(readTitles({ declared: ["Look at our openings - Aperture Science"] }).company, "");
  assert.equal(employer("Job Application for Engineer at Aperture Science", "Engineer"), "Aperture Science");
  assert.equal(employer("Reengineer at Acme", "Engineer"), "", "the job is a whole word");
});

test("a line splits on the separators boards use and nowhere else", () => {
  const parts = (line) => split(line).map(([, part]) => part);
  assert.deepEqual(parts("Engineer - Aperture Science | Board"), ["Engineer", "Aperture Science", "Board"]);
  assert.deepEqual(parts("Engineer — Lisbon · Aperture Science"), ["Engineer", "Lisbon", "Aperture Science"]);
  assert.deepEqual(parts("Front-end Developer - Acme"), ["Front-end Developer", "Acme"]);
  assert.deepEqual(parts("Internship 2025–2026"), ["Internship 2025–2026"]);
  assert.deepEqual(parts("| Engineer |"), ["Engineer"]);
});

test("the site signing a line is recognised by its address", () => {
  assert.equal(isSite("Indeed.com", { host: "pt.indeed.com" }), true);
  assert.equal(isSite("LinkedIn", { host: "www.linkedin.com" }), true);
  assert.equal(isSite("Careers", { host: "careers.aperture.example" }), true);
  assert.equal(isSite("ASP.NET", { host: "careers.aperture.example" }), false);
  assert.equal(isSite("com", { host: "careers.aperture.example" }), false);
  assert.equal(isSite("Aperture Science", { host: "careers.aperture.example" }), false);
});

// ------------------------------------------------------------------ pay and a closing date

const advert = (lang, body) =>
  read(`<html lang="${lang}"><head><title>Test Chamber Engineer</title></head>
        <body><main><h1>Test Chamber Engineer</h1>${BLURB}${body}</main></body></html>`);

test("British English: pounds per annum, and a date written day first", () => {
  const data = advert("en-GB", "<ul><li>Salary: £45,000 – £55,000 per annum</li><li>Closing date: 03/04/2026</li></ul>");
  assert.deepEqual(pay(data), ["45000", "55000", "GBP", "year"]);
  assert.equal(data.closes_at, "2026-04-03");
});

test("American English: a dollar sign the region settles, and a date written month first", () => {
  const data = advert("en-US", "<p>Pay range: $120,000 - $140,000 a year</p><p>Apply by: 04/03/2026</p>");
  assert.deepEqual(pay(data), ["120000", "140000", "USD", "year"]);
  assert.equal(data.closes_at, "2026-04-03");
});

test("what reads two ways is not read", () => {
  const data = advert("en", "<p>Salary: $120,000</p><p>Closing date: 03/04/2026</p><p>Apply by 30 October, and hear back.</p>");
  assert.equal(data.closes_at, null);
  assert.deepEqual(pay(data), [null, null, "", ""]);
});

test("a ceiling written in a hurry, and an ISO date", () => {
  const data = advert("en", "<p>Salary: up to €50k</p><p>Applications close on 2026-10-30.</p>");
  assert.deepEqual(pay(data), [null, "50000", "EUR", ""]);
  assert.equal(data.closes_at, "2026-10-30");
});

test("words that label nothing, or two salaries that disagree, are no reading", () => {
  for (const body of [
    "<p>We run a salary sacrifice scheme worth up to £500 a year.</p><p>Deadline: ASAP. Start date: 01/11/2026</p>",
    "<h2>Senior</h2><p>Salary: €45,000</p><h2>Junior</h2><p>Salary: €38,000</p>",
  ]) {
    const data = advert("en-GB", body);
    assert.deepEqual(pay(data), [null, null, "", ""]);
    assert.equal(data.closes_at, null);
  }
});

test("a Twitter card's pairs are read like a line of the page", () => {
  const data = read(
    `<html lang="en-GB"><head><title>Test Chamber Engineer · Aperture Science</title>
     <meta name="twitter:label1" content="Salary" /><meta name="twitter:data1" content="£40,000 – £48,000 per annum" />
     <meta name="twitter:label2" content="Closing date" /><meta name="twitter:data2" content="30 October 2026" /></head>
     <body><main><h1>Test Chamber Engineer</h1>${BLURB}</main></body></html>`,
  );
  assert.deepEqual(pay(data), ["40000", "48000", "GBP", "year"]);
  assert.equal(data.closes_at, "2026-10-30");
  assert.equal(data.company_name, "", "a part of the title nothing vouches for");
});

test("a date is read in the month names and the order of the page's language", () => {
  assert.equal(closingDate("Closing date: 30 de outubro de 2026", "pt-PT"), "2026-10-30");
  assert.equal(closingDate("Closing date: 30 octobre 2026", "fr"), "2026-10-30");
  assert.equal(closingDate("Closing date: 03/04/2026", "pt-PT"), "2026-04-03");
  assert.equal(closingDate("Closing date: 03/04/2026", "en"), null);
  assert.equal(closingDate("Closing date: 31/02/2026", "pt-PT"), null, "not a day");
});

test("a figure is read however it is grouped", () => {
  const cases = [
    ["1.385,99", "1385.99"], ["1,385.99", "1385.99"], ["45.000", "45000"], ["45,000", "45000"],
    ["45 000", "45000"], ["45 000", "45000"], ["1'250'000", "1250000"], ["12,50", "12.50"],
    ["1.234.567", "1234567"],
  ];
  for (const [written, value] of cases) {
    assert.equal(figure(written), value, written);
  }
});

test("a salary in the Portuguese way, under an English label", () => {
  assert.deepEqual(salary("Salary: 1.385,99 € monthly", "pt-PT"), {
    low: "1385.99", high: null, currency: "EUR", period: "month",
  });
});

test("the order a numeric date is written in comes from the page's language", () => {
  const cases = [["pt-PT", "dmy"], ["pt", "dmy"], ["fr", "dmy"], ["de", "dmy"], ["en-GB", "dmy"], ["en-US", "mdy"], ["en", ""], ["", ""]];
  for (const [tag, written] of cases) {
    assert.equal(order(tag), written, tag);
  }
});

test("a page's language tag is a stranger's text", () => {
  assert.equal(tagOf("pt_PT"), "pt-PT");
  assert.equal(tagOf("en-US,en;q=0.9"), "en-US");
  assert.equal(tagOf("pt-br"), "pt-BR");
  assert.equal(tagOf("<script>"), "");
  assert.equal(tagOf("x".repeat(60)), "");
});

test("a period is the one the figure's label states, not one earlier on the line", () => {
  const cases = [
    ["You get a monthly travel allowance and a salary of €40,000.", ""],
    ["Hourly paid overtime on top of a salary of €40,000.", ""],
    ["Daily standups. Salary: €40,000", ""],
    ["Monthly team lunches | Salary €3,500", ""],
    ["Monthly salary: €3,500", "month"],
    ["Gross annual salary: €40,000", "year"],
    ["Salary (monthly): €3,500", "month"],
    ["Salary: €40,000 per month", "month"],
  ];
  for (const [written, period] of cases) {
    assert.equal(salary(written, "en").period, period, written);
  }
});

test("a long run of unicode spaces does not make the search quadratic", () => {
  const started = Date.now();
  assert.equal(salary(`Benefits${" ".repeat(50000)}Salary: €40,000`, "en").low, "40000");
  assert.ok(Date.now() - started < 2000);
});
