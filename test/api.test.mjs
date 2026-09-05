// Runs with `node --test`: the pure parts, without a browser.
import assert from "node:assert/strict";
import { test } from "node:test";

import { capture, describe, endpoint, normaliseInstance, originPattern, readResponse, whoAmI } from "../src/lib/api.js";

test("an instance address is cleaned and https is insisted on away from home", () => {
  assert.equal(normaliseInstance("postulo.example.org"), "https://postulo.example.org");
  assert.equal(normaliseInstance("https://postulo.example.org/"), "https://postulo.example.org");
  assert.equal(normaliseInstance("https://postulo.example.org/api/v1/"), "https://postulo.example.org");
  assert.equal(normaliseInstance("https://host.example/postulo/?x=1#y"), "https://host.example/postulo");
  assert.equal(normaliseInstance("http://localhost:8000"), "http://localhost:8000");
  assert.equal(normaliseInstance("http://pi.local"), "http://pi.local");
  assert.throws(() => normaliseInstance("http://postulo.example.org"), /https/);
  assert.throws(() => normaliseInstance(""), /Enter/);
  assert.throws(() => normaliseInstance("not a url at all :::"), /web address/);
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
  await assert.rejects(readResponse(fakeResponse(401, {})), /does not accept this token/);
  await assert.rejects(readResponse(fakeResponse(403, { detail: "This token does not have the 'captures' scope." })), /captures/);
  await assert.rejects(readResponse(fakeResponse(422, { detail: "That page yielded nothing." })), /nothing/);
  await assert.rejects(readResponse(fakeResponse(429, {})), /Wait a minute/);
  await assert.rejects(readResponse(fakeResponse(500, null)), /answered 500/);
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
