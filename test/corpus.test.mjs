// The corpus: whole pages, read end to end, against what a person would have typed.
//
// `parse.test.mjs` covers the pieces — one helper, one shape, one value. This covers the
// thing somebody actually does, which is press the button on a page from a real board, and
// it is the only test here that can answer "is it accurate?" with a number rather than an
// opinion.
//
// Each case is a pair in `fixtures/`: `<name>.html` is the page and `<name>.json` is every
// field expected out of it, with a `why` saying what that board does differently. The
// pages are written here rather than saved from the web — a saved advert is somebody
// else's copyright and it goes stale the week the posting closes — but every quirk in them
// was taken from a live page of that board and the file says which.
//
// Adding a board: save its page, run `node scripts/corpus.mjs <page.html> <address>` to see
// what is read off it now (the address it was read at; a fixture's own `.json` gives it),
// reduce it to the smallest page that still shows the quirk, and write down what should
// come out, starting from the `posting` the script prints. A fixture nobody can explain is
// a fixture nobody can fix.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { JSDOM } from "jsdom";

import { readPosting, readPostings, slimPage } from "../src/lib/parse.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const parse = (html) => new JSDOM(html).window.document;

const cases = fs
  .readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".json"))
  .map((name) => {
    const stem = name.slice(0, -".json".length);
    return {
      stem,
      expected: JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")),
      html: fs.readFileSync(path.join(FIXTURES, `${stem}.html`), "utf8"),
    };
  });

// A results page read whole: every posting it lists, each as its own, none of them the
// page itself -- and the same page opened on one of them is that one's page (#177).
test("search-results: every posting a results page lists is read as its own", () => {
  const { html } = cases.find((each) => each.stem === "search-results");
  const listed = readPostings(parse(html), "https://careers.blackmesa.example/jobs?q=engineer", parse);
  assert.equal(listed.length, 3);
  const urls = listed.map((posting) => posting.data.url);
  assert.equal(new Set(urls).size, 3, "each read as the address it states");
  assert.ok(urls.every((url) => url.startsWith("https://careers.blackmesa.example/jobs/")));
  assert.ok(listed.every((posting) => !posting.here), "a results page is nobody's page");
  assert.ok(listed.every((posting) => posting.source === "schema.org" && posting.data.title));

  const opened = readPostings(parse(html), "https://careers.blackmesa.example/jobs/2891", parse);
  assert.deepEqual(opened.map((posting) => posting.here), [false, true, false]);
});

// A corpus that quietly became empty would pass every assertion below it.
test("there is a corpus", () => {
  assert.ok(cases.length >= 6, `only ${cases.length} fixtures found in ${FIXTURES}`);
});

for (const { stem, expected, html } of cases) {
  test(`${stem}: ${expected.why}`, () => {
    const read = readPosting(parse(html), expected.url, parse);
    assert.ok(read, "the page was read at all");
    assert.equal(read.source, expected.source, "read by the source the board is marked up for");

    // Field by field rather than one deepEqual: a whole posting printed as a diff is
    // unreadable, and the field that is wrong is the thing worth naming.
    for (const [field, want] of Object.entries(expected.data)) {
      assert.deepEqual(read.data[field], want, `${stem}.${field}`);
    }
    assert.deepEqual(
      Object.keys(read.data).sort(),
      Object.keys(expected.data).sort(),
      `${stem}: the fixture states every field Postulo has`,
    );
  });
}

// The kept copy of a page is read as the page was (#68): what it drops is not what a posting
// is read from.
for (const { stem, expected, html } of cases) {
  test(`${stem}: the slimmed page reads as the page does`, () => {
    const doc = parse(html);
    assert.deepEqual(readPosting(parse(slimPage(doc)), expected.url, parse), readPosting(doc, expected.url, parse));
  });
}

// The script the paragraph above names prints what this test reads (#20).
test("scripts/corpus.mjs prints what is read off a fixture", () => {
  const script = path.join(path.dirname(FIXTURES), "..", "scripts", "corpus.mjs");
  const { expected } = cases.find((each) => each.stem === "greenhouse");
  const run = spawnSync(process.execPath, [script, path.join(FIXTURES, "greenhouse.html")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const printed = JSON.parse(run.stdout);
  assert.equal(printed.posting.url, expected.url);
  assert.equal(printed.posting.source, expected.source);
  assert.deepEqual(printed.posting.data, expected.data);
});
