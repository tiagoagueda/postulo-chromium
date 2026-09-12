// Runs with `node --test`: the pure parts, without a browser.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Refusal,
  capture,
  describe,
  kindOfFailure,
  endpoint,
  normaliseInstance,
  originPattern,
  problemOf,
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

test("asking what is known sends the postings and brings the answers back", async () => {
  const { known } = await import("../src/lib/api.js");
  let sent = null;
  const answers = await known(
    "https://postulo.example.org",
    "tok",
    [{ url: "https://jobs.example/1", title: "Research Engineer", company_name: "Black Mesa" }, { url: "https://jobs.example/2" }],
    async (url, init) => {
      sent = { url, method: init.method, body: JSON.parse(init.body) };
      return fakeResponse(200, [{ url: "https://jobs.example/1", listings: [{ id: 3 }], captures: [], similar: [] }, { url: "https://jobs.example/2", listings: [], captures: [], similar: [] }]);
    },
  );
  assert.equal(sent.url, "https://postulo.example.org/api/v1/captures/known");
  assert.equal(sent.method, "POST");
  assert.deepEqual(sent.body, {
    postings: [
      { url: "https://jobs.example/1", title: "Research Engineer", company: "Black Mesa" },
      { url: "https://jobs.example/2", title: "", company: "" },
    ],
  });
  assert.equal(answers[0].listings[0].id, 3);
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

test("what goes wrong says whether to try again later", async () => {
  const failure = async (status, body = {}) => {
    try {
      await readResponse(fakeResponse(status, body));
    } catch (error) {
      return error;
    }
    throw new Error("expected a failure");
  };
  assert.equal(kindOfFailure(new TypeError("Failed to fetch")), "later");
  assert.equal(kindOfFailure(await failure(503)), "later");
  assert.equal(kindOfFailure(await failure(429)), "later");
  assert.equal(kindOfFailure(await failure(401)), "account");
  assert.equal(kindOfFailure(await failure(403, { detail: "No captures scope." })), "account");
  assert.equal(kindOfFailure(await failure(422, { detail: "Nothing there." })), "refused");
  assert.equal(kindOfFailure(await failure(404, null)), "refused");
  assert.deepEqual(problemOf(await failure(401)), { key: "tokenRefused", substitutions: [{ key: "tokenPath" }] });
  assert.deepEqual(problemOf(await failure(422, { detail: "Nothing there." })), { message: "Nothing there." });
});

test("a capture carries what was reviewed, and nothing when there is nothing", async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return fakeResponse(201, { title: "Senior Research Engineer", review_url: "https://postulo.example.org/r/1" });
  };
  await capture("https://postulo.example.org", "tok", { url: "u", html: "h", data: { title: "Senior Research Engineer" } }, fetchImpl);
  await capture("https://postulo.example.org", "tok", { url: "u", html: "h", data: {} }, fetchImpl);
  await capture("https://postulo.example.org", "tok", { url: "u", html: "h" }, fetchImpl);
  // Several from one page: the batch's shape goes, never the browser's own id for it (#177).
  await capture("https://postulo.example.org", "tok", { url: "u", html: "h", batch: { id: "c1", size: 3, position: 2 } }, fetchImpl);
  await capture("https://postulo.example.org", "tok", { url: "u", html: "h", batch: { id: "c1", size: 1, position: 1 } }, fetchImpl);
  assert.deepEqual(bodies, [
    { url: "u", html: "h", data: { title: "Senior Research Engineer" } },
    { url: "u", html: "h" },
    { url: "u", html: "h" },
    { url: "u", html: "h", batch: { size: 3, position: 2 } },
    { url: "u", html: "h" },
  ]);
});
