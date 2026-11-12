// What the extension reads off a saved page, as the corpus test reads it.
//
//   node scripts/corpus.mjs <page.html> [address]
//
// Prints, as JSON, what `readPosting()` and `readPostings()` from `src/lib/parse.js` return
// for that page, parsed with jsdom exactly as `test/corpus.test.mjs` parses a fixture. The
// address is the one the page would have been read at: the second argument, or else the
// `url` of a fixture's `<name>.json` beside the page. A page saved from the web needs it,
// since some sources fall back on it and a results page compares postings with it.
//
// The `posting` part is in the shape a fixture's `.json` takes (`url`, `source`, `data`),
// so a new fixture can start from it: correct what is wrong, add a `why`.

import fs from "node:fs";
import path from "node:path";

import { JSDOM } from "jsdom";

import { readPosting, readPostings } from "../src/lib/parse.js";

const [file, given] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/corpus.mjs <page.html> [address]");
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`no such page: ${file}`);
  process.exit(2);
}

let url = given;
if (!url) {
  const fixture = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.json`);
  if (fs.existsSync(fixture)) {
    url = JSON.parse(fs.readFileSync(fixture, "utf8")).url;
  }
}
if (!url) {
  console.error("no address: give the one the page was read at, as the second argument");
  process.exit(2);
}

const html = fs.readFileSync(file, "utf8");
const parse = (text) => new JSDOM(text).window.document;

const read = readPosting(parse(html), url, parse);
const listed = readPostings(parse(html), url, parse);

console.log(
  JSON.stringify(
    {
      posting: read ? { url, source: read.source, data: read.data } : null,
      postings: listed.map(({ data, source, here }) => ({ source, here, data })),
    },
    null,
    2,
  ),
);
