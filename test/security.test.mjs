// Runs with `node --test`: what the security review of 2026-10-16 found (SEC2-076 to 084)
// and the refused permission prompt (#28).
import assert from "node:assert/strict";
import { test } from "node:test";

import { JSDOM } from "jsdom";

import { shipped } from "../scripts/build.mjs";
import { askAndKeep } from "../src/lib/allow.js";
import { capture, extraScopes, health, known, whoAmI } from "../src/lib/api.js";
import { readPosting } from "../src/lib/parse.js";
import { onInstance } from "../src/lib/rendering.js";

const INSTANCE = "https://postulo.example.org";

test("every call is made with redirects refused, so the token goes to the configured address only", async () => {
  const inits = [];
  const fetchImpl = async (url, init) => {
    inits.push(init);
    return { ok: true, status: 200, json: async () => ({ scopes: ["captures"], answers: [], id: 1, status: "ok" }) };
  };
  await whoAmI(INSTANCE, "tok", fetchImpl);
  await capture(INSTANCE, "tok", { url: "https://e.org/j/1", html: "<html>" }, fetchImpl);
  await health(INSTANCE, fetchImpl);
  await known(INSTANCE, "tok", [{ title: "t" }], fetchImpl).catch(() => {});
  assert.ok(inits.length >= 3);
  for (const init of inits) {
    assert.equal(init.redirect, "error");
  }
});

test("a token wider than captures is named, and a token with captures alone is not", () => {
  assert.deepEqual(extraScopes({ scopes: ["captures", "read", "listings:bind"] }), ["read", "listings:bind"]);
  assert.deepEqual(extraScopes({ scopes: ["captures"] }), []);
  assert.deepEqual(extraScopes({}), []);
});

test("an address the server supplies is kept only on the instance's own origin", () => {
  assert.equal(onInstance("/review/4/", INSTANCE), `${INSTANCE}/review/4/`);
  assert.equal(onInstance(`${INSTANCE}/review/4/`, INSTANCE), `${INSTANCE}/review/4/`);
  assert.equal(onInstance("https://evil.example/review/4/", INSTANCE), "");
  assert.equal(onInstance("http://postulo.example.org/review/4/", INSTANCE), "");
  assert.equal(onInstance("javascript:alert(1)", INSTANCE), "");
  assert.equal(onInstance(undefined, INSTANCE), "");
  assert.equal(onInstance("/x", ""), "");
});

test("a catalogue cannot override the language and direction the build writes", () => {
  const built = shipped(
    { languageTag: { message: "nonsense" }, direction: { message: "sideways" }, hello: { message: "x" } },
    { tag: "fr-FR", direction: "ltr" },
  );
  assert.equal(built.languageTag.message, "fr-FR");
  assert.equal(built.direction.message, "ltr");
  assert.equal(built.hello.message, "x");
});

test("a megabyte of tag openers that never close is read in about a second, and cut", () => {
  const parse = (html) => new JSDOM(html).window.document;
  const hostile = "<a ".repeat(350_000);
  const page = parse(
    `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org/",
      "@type": "JobPosting",
      title: "Engineer",
      description: hostile,
    })}</script></head><body></body></html>`,
  );
  const started = Date.now();
  const read = readPosting(page, "https://jobs.example.org/1", parse);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.equal(read.data.title, "Engineer");
  assert.ok(read.data.description.length <= 40_000);
});

test("a description with real tags is still read as text", () => {
  const parse = (html) => new JSDOM(html).window.document;
  const page = parse(
    `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org/",
      "@type": "JobPosting",
      title: "Engineer",
      description: '&lt;p class="a>b"&gt;Hard &amp;amp; hats&lt;/p&gt;<p title=\'x>y\'>Plain</p>',
    })}</script></head><body></body></html>`,
  );
  const read = readPosting(page, "https://jobs.example.org/1", parse);
  assert.match(read.data.description, /Hard/);
  assert.match(read.data.description, /Plain/);
  assert.doesNotMatch(read.data.description, /<p|x>y/);
});

test("a refused permission prompt is reported once, and the capture is still kept", async () => {
  let said = 0;
  const value = await askAndKeep(
    async () => false,
    async () => "record",
    () => {
      said += 1;
    },
  );
  assert.equal(value, "record");
  assert.equal(said, 1);
  let silent = 0;
  await askAndKeep(async () => true, async () => "r", () => (silent += 1));
  await askAndKeep(null, async () => "r", () => (silent += 1));
  assert.equal(silent, 0);
});
