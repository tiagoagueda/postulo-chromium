// Runs with `node --test`: the pure parts, without a browser.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Refusal,
  capture,
  describe,
  kindOfFailure,
  endpoint,
  newListingUrl,
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
  assert.throws(() => normaliseInstance("http://pi.local"), refusal("httpsOnly"));
  assert.equal(normaliseInstance("https://pi.local"), "https://pi.local");
  assert.throws(
    () => normaliseInstance("https://user:secret@postulo.example.org"),
    refusal("noCredentialsInAddress"),
  );
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

test("a refused capture says which field is wrong, in either shape Postulo sends", async () => {
  // Postulo answers refusals as RFC 9457 problem documents since postulo/postulo#296: the
  // per-field list is `errors` and `detail` is a one-line summary of it. Before that the
  // list *was* `detail`. An extension is updated on a different day from the instance it
  // talks to, so both are read and both say the same thing (#1).
  const fields = [{ loc: ["body", "payload", "data", "title"], msg: "Value error, A posting needs a title." }];
  const said = { message: "title: Value error, A posting needs a title." };

  await assert.rejects(
    readResponse(
      fakeResponse(422, {
        type: "https://example.org/wiki/The-capture-API#validation-failed",
        title: "The request was not in the shape this call takes",
        status: 422,
        detail: "Refused: title. See `errors` for what is wrong with each.",
        instance: "/api/v1/captures",
        errors: fields,
      }),
    ),
    said,
    "the summary is not what to show when the fields are there",
  );
  await assert.rejects(readResponse(fakeResponse(422, { detail: fields })), said, "an older Postulo");
});

test("a refusal that is not about a field still says Postulo's own sentence", async () => {
  // "That page yielded nothing" names no field, so there is nothing for `errors` to hold
  // and the summary is the whole of what there is to say.
  await assert.rejects(
    readResponse(fakeResponse(422, { status: 422, detail: "That page yielded nothing.", errors: [] })),
    /nothing/,
  );
  await assert.rejects(readResponse(fakeResponse(422, { detail: "That page yielded nothing." })), /nothing/);
});

test("a refusal carries what a caller would act on, beside the sentence it shows", async () => {
  // The sentence is for the person; these are for the code. A 403 will never succeed
  // however often it is tried, and a 429 will -- after this long.
  const scoped = await readResponse(fakeResponse(403, { detail: "No 'captures' scope.", scope: "captures" })).catch(
    (error) => error,
  );
  assert.equal(scoped.scope, "captures");

  const waited = await readResponse(fakeResponse(429, { detail: "Too many.", retry_after: 42 })).catch(
    (error) => error,
  );
  assert.equal(waited.key, "tooMany", "and the sentence shown is unchanged");
  assert.equal(waited.retryAfter, 42);

  const older = await readResponse(fakeResponse(429, {})).catch((error) => error);
  assert.equal(older.retryAfter, undefined, "an older Postulo says nothing, rather than zero");
});

test("a malformed problem document is still a refusal rather than a crash", async () => {
  // What comes back on a refusal is the least tested path in any client, and the one most
  // likely to arrive from a proxy rather than from Postulo.
  await assert.rejects(readResponse(fakeResponse(422, null)), refusal("answered", ["422"]));
  await assert.rejects(readResponse(fakeResponse(422, { errors: "not a list" })), refusal("answered", ["422"]));
  await assert.rejects(readResponse(fakeResponse(422, { errors: [{ loc: 7 }] })), refusal("answered", ["422"]));
  await assert.rejects(readResponse(fakeResponse(429, { retry_after: "soon" })), refusal("tooMany"));
});

test("the client accepts both the media type an answer uses and the one a refusal uses", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init);
    return fakeResponse(201, { id: 1 });
  };
  await capture("https://postulo.example.org", "tok", { url: "https://e.org/j/1", html: "<html>" }, fetchImpl);

  assert.match(calls[0].headers.Accept, /application\/problem\+json/);
  assert.match(calls[0].headers.Accept, /application\/json/);
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
  assert.equal(kindOfFailure(await failure(409)), "later");
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

test("asking what is known keeps within the server's limits", async () => {
  const { known } = await import("../src/lib/api.js");
  const bodies = [];
  const postings = Array.from({ length: 150 }, (_, i) => ({ url: `https://jobs.example/${i}`, title: "t".repeat(400), company_name: "c".repeat(400) }));
  const answers = await known("https://postulo.example.org", "tok", postings, async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return fakeResponse(200, body.postings.map((posting) => ({ url: posting.url, listings: [], captures: [], similar: [] })));
  });
  assert.deepEqual(bodies.map((body) => body.postings.length), [100, 50]);
  assert.ok(bodies.every((body) => body.postings.every((p) => p.title.length <= 250 && p.company.length <= 250)));
  assert.equal(answers.length, 150);
  const sent = [];
  await known("https://postulo.example.org", "tok", [{ url: `https://j.example/1#${"f".repeat(600)}` }, { url: `https://j.example/${"a".repeat(600)}` }], async (url, init) => {
    sent.push(...JSON.parse(init.body).postings.map((p) => p.url));
    return fakeResponse(200, [{}, {}]);
  });
  assert.deepEqual(sent, ["https://j.example/1", ""]);
});

test("a 2xx answer that is not Postulo's JSON is a refusal with no status, so a capture waits", async () => {
  const html = { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } };
  await assert.rejects(readResponse(html), (error) => refusal("notPostulo")(error) && error.status === undefined);
  const error = await readResponse(html).catch((caught) => caught);
  assert.equal(kindOfFailure(error), "later");
  await assert.rejects(readResponse(fakeResponse(200, null)), refusal("notPostulo"));
});

test("the page that adds a listing is Postulo's own, under its path prefix, with nothing of ours in it", () => {
  assert.equal(newListingUrl("https://postulo.example"), "https://postulo.example/listings/new/");
  assert.equal(newListingUrl("https://example.org/postulo"), "https://example.org/postulo/listings/new/");
});
