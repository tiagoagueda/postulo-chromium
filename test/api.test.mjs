// Runs with `node --test`: the pure parts, without a browser.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Refusal,
  capture,
  corrections,
  describe,
  endpoint,
  normaliseInstance,
  originPattern,
  preview,
  readResponse,
  whoAmI,
} from "../src/lib/api.js";

// The extension's own refusals carry a key into _locales, not a sentence: said in the browser's language.
const refusal = (key, substitutions = []) => (error) =>
  error instanceof Refusal && error.key === key && JSON.stringify(error.substitutions) === JSON.stringify(substitutions);

test("an instance address is cleaned and https is insisted on away from home", () => {
  assert.equal(normaliseInstance("postulo.example.org"), "https://postulo.example.org");
  assert.equal(normaliseInstance("https://postulo.example.org/"), "https://postulo.example.org");
  assert.equal(normaliseInstance("https://postulo.example.org/api/v1/"), "https://postulo.example.org");
  assert.equal(normaliseInstance("https://host.example/postulo/?x=1#y"), "https://host.example/postulo");
  assert.equal(normaliseInstance("http://localhost:8000"), "http://localhost:8000");
  assert.equal(normaliseInstance("http://pi.local"), "http://pi.local");
  assert.throws(() => normaliseInstance("http://postulo.example.org"), refusal("httpsOnly"));
  assert.throws(() => normaliseInstance(""), refusal("enterAddress"));
  assert.throws(() => normaliseInstance("not a url at all :::"), refusal("notAnAddress"));
});

test("the host permission asked for is the instance's origin and nothing wider", () => {
  assert.equal(originPattern("https://postulo.example.org"), "https://postulo.example.org/*");
  assert.equal(originPattern("https://host.example:8443/postulo"), "https://host.example:8443/*");
  assert.equal(endpoint("https://host.example/postulo", "/captures"), "https://host.example/postulo/api/v1/captures");
});

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("responses become data or a sentence a person can act on", async () => {
  assert.deepEqual(await readResponse(fakeResponse(201, { id: 1 })), { id: 1 });
  await assert.rejects(readResponse(fakeResponse(401, {})), refusal("tokenRefused", [{ key: "tokenPath" }]));
  await assert.rejects(readResponse(fakeResponse(403, { detail: "This token does not have the 'captures' scope." })), /captures/);
  await assert.rejects(readResponse(fakeResponse(403, {})), refusal("notAllowed"));
  await assert.rejects(readResponse(fakeResponse(422, { detail: "That page yielded nothing." })), /nothing/);
  await assert.rejects(
    readResponse(fakeResponse(422, { detail: [{ loc: ["body", "payload", "data", "title"], msg: "Value error, A posting needs a title." }] })),
    { message: "title: Value error, A posting needs a title." },
  );
  await assert.rejects(readResponse(fakeResponse(429, {})), refusal("tooMany"));
  await assert.rejects(readResponse(fakeResponse(500, null)), refusal("answered", ["500"]));
});

test("a capture posts the page to the configured instance with the token, and to nothing else", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return fakeResponse(201, { title: "Research Engineer", company_name: "Black Mesa", location: "Lyon", source: "schema.org", review_url: "https://postulo.example.org/jobs/captures/7/review/" });
  };
  const result = await capture("https://postulo.example.org", "tok", { url: "https://jobs.example/1", html: "<html>" }, fetchImpl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://postulo.example.org/api/v1/captures");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(calls[0].init.body), { url: "https://jobs.example/1", html: "<html>" });
  assert.equal(describe(result), "Research Engineer — Black Mesa, Lyon");
  assert.equal(describe({ title: "" }), "Untitled posting");
  assert.equal(describe({ title: "" }, "Anúncio sem título"), "Anúncio sem título");
});

test("the test button asks /me", async () => {
  let asked = "";
  const me = await whoAmI("https://postulo.example.org", "tok", async (url) => {
    asked = url;
    return fakeResponse(200, { name: "laptop", owner: "alex", scopes: ["captures"] });
  });
  assert.equal(asked, "https://postulo.example.org/api/v1/me");
  assert.deepEqual(me.scopes, ["captures"]);
});

const READ = {
  title: "Research Engineer",
  company_name: "Black Mesa",
  location: "",
  remote_type: "",
  employment_type: "full_time",
  description: "Science.",
  salary_min: "55000.00",
  salary_max: null,
  salary_currency: "EUR",
  salary_period: "year",
  closes_at: "2026-10-01",
};

function asTheFormShowsIt(read) {
  return Object.fromEntries(Object.entries(read).map(([field, value]) => [field, value === null ? "" : String(value)]));
}

test("a preview asks Postulo what it reads, and an older Postulo is told apart from a refusal", async () => {
  const calls = [];
  const seen = await preview("https://postulo.example.org", "tok", { url: "https://jobs.example/1", html: "<html>" }, async (url, init) => {
    calls.push({ url, init });
    return fakeResponse(200, { url: "https://jobs.example/1", source: "schema.org", data: READ });
  });
  assert.equal(calls[0].url, "https://postulo.example.org/api/v1/captures/preview");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { url: "https://jobs.example/1", html: "<html>" });
  assert.equal(seen.data.title, "Research Engineer");

  assert.equal(await preview("https://old.example.org", "tok", { url: "u", html: "h" }, async () => fakeResponse(404, null)), null);
  await assert.rejects(
    preview("https://postulo.example.org", "tok", { url: "u", html: "h" }, async () => fakeResponse(422, { detail: "Nothing resembling a job posting was found there." })),
    /job posting/,
  );
});

test("nothing touched is nothing corrected, whatever shape Postulo wrote it in", () => {
  assert.deepEqual(corrections(READ, asTheFormShowsIt(READ)), {});
  assert.deepEqual(corrections(READ, { ...asTheFormShowsIt(READ), salary_min: "55000" }), {});
  assert.deepEqual(corrections(READ, { ...asTheFormShowsIt(READ), title: "  Research Engineer " }), {});
});

test("only what was changed is sent, and an emptied field is cleared rather than kept", () => {
  const form = {
    ...asTheFormShowsIt(READ),
    title: "Senior Research Engineer",
    location: "Lyon",
    salary_min: "",
    salary_max: "65000",
    closes_at: "",
    remote_type: "hybrid",
  };
  assert.deepEqual(corrections(READ, form), {
    title: "Senior Research Engineer",
    location: "Lyon",
    salary_min: null,
    salary_max: "65000",
    closes_at: null,
    remote_type: "hybrid",
  });
});

test("a capture carries the corrections, and none when there are none", async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return fakeResponse(201, { title: "Senior Research Engineer", review_url: "https://postulo.example.org/r/1" });
  };
  await capture("https://postulo.example.org", "tok", { url: "u", html: "h", data: { title: "Senior Research Engineer" } }, fetchImpl);
  await capture("https://postulo.example.org", "tok", { url: "u", html: "h", data: {} }, fetchImpl);
  await capture("https://postulo.example.org", "tok", { url: "u", html: "h" }, fetchImpl);
  assert.deepEqual(bodies, [
    { url: "u", html: "h", data: { title: "Senior Research Engineer" } },
    { url: "u", html: "h" },
    { url: "u", html: "h" },
  ]);
});
