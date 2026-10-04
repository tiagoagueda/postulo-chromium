// Runs with `node --test`: the number on the toolbar button, from what waits in Postulo and here.
import assert from "node:assert/strict";
import { test } from "node:test";

import { badgeText, countPostings, lastWaiting, readWaiting, refreshWaiting, WAITING } from "../src/lib/waiting.js";

const row = (id, url) => ({ id, url, title: `T${id}`, company_name: "Black Mesa", location: "Lyon", created_at: "2026-10-01T09:00:00Z", review_url: `https://p.example/r/${id}`, page: { big: "x" }, status: "pending" });
const here = (id, url, state = "kept") => ({ id, url, state });

function memoryArea() {
  const data = new Map();
  return {
    data,
    async get(key) {
      return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        data.set(key, structuredClone(value));
      }
    },
  };
}

/** A Postulo that lists `rows` 100 at a time (or `limit`), recording what was asked. */
function postulo(rows, asked = []) {
  return async (url) => {
    asked.push(url);
    const { searchParams } = new URL(url);
    const limit = Number(searchParams.get("limit"));
    const offset = Number(searchParams.get("offset"));
    return new Response(JSON.stringify({ items: rows.slice(offset, offset + limit), count: rows.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

const SETTINGS = { instance: "https://p.example", token: "t", offline: false };
const yes = async () => true;

test("two captures of one posting, with and without www, and another kept here, are two", () => {
  const rows = [row(1, "https://www.example.org/jobs/42/"), row(2, "http://example.org/jobs/42")];
  assert.equal(countPostings(rows, [here("a", "https://other.example/jobs/7")]), 2);
});

test("a capture here that Postulo has, or has sent, counts once or not at all", () => {
  const rows = [row(1, "https://example.org/jobs/42")];
  assert.equal(countPostings(rows, [here("a", "https://www.example.org/jobs/42/", "waiting")]), 1);
  assert.equal(countPostings(rows, [here("a", "https://example.org/jobs/9", "sent")]), 1);
  assert.equal(countPostings([], [here("a", "https://example.org/jobs/9", "refused")]), 1);
});

test("addresses that name no host count for themselves", () => {
  assert.equal(countPostings([row(1, "nonsense"), row(2, "nonsense")], [here("a", "nonsense")]), 3);
});

test("the badge fits about four characters", () => {
  assert.deepEqual([0, 1, 99, 100, 5000].map(badgeText), ["", "1", "99", "99+", "99+"]);
});

test("the list is read in pages of 100 until the count is reached, and keeps no page", async () => {
  const rows = Array.from({ length: 230 }, (_, index) => row(index + 1, `https://example.org/${index}`));
  const asked = [];
  const got = await readWaiting({ instance: "https://p.example", token: "t", fetchImpl: postulo(rows, asked) });
  assert.equal(got.length, 230);
  assert.equal(asked.length, 3);
  assert.deepEqual(Object.keys(got[0]), ["id", "url", "title", "company_name", "location", "created_at", "review_url"]);
});

test("after a 429 it waits as the refusal says, then goes on", async () => {
  const rows = [row(1, "https://example.org/1")];
  let calls = 0;
  const waited = [];
  const fetchImpl = async (url) => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ retry_after: 7 }), { status: 429 });
    }
    return postulo(rows)(url);
  };
  const got = await readWaiting({ instance: "https://p.example", token: "t", fetchImpl, sleep: async (s) => waited.push(s) });
  assert.deepEqual(waited, [7]);
  assert.equal(got.length, 1);
});

test("a wait too long is left to the next alarm", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ retry_after: 900 }), { status: 429 });
  await assert.rejects(readWaiting({ instance: "https://p.example", token: "t", fetchImpl, sleep: async () => assert.fail("waited") }));
});

test("a read is kept with when it was made; a failed one leaves the last copy", async () => {
  const area = memoryArea();
  const rows = [row(1, "https://example.org/1")];
  const read = await refreshWaiting({ area, settings: SETTINGS, allowed: yes, fetchImpl: postulo(rows), now: () => 1000 });
  assert.equal(read.outcome, "read");
  assert.equal(area.data.get(WAITING).rows.length, 1);
  assert.equal(area.data.get(WAITING).at, new Date(1000).toISOString());

  const down = await refreshWaiting({ area, settings: SETTINGS, allowed: yes, fetchImpl: async () => Promise.reject(new TypeError("fetch failed")) });
  assert.equal(down.outcome, "unreachable");
  const refused = await refreshWaiting({ area, settings: SETTINGS, allowed: yes, fetchImpl: async () => new Response("{}", { status: 401 }) });
  assert.equal(refused.outcome, "account");
  assert.equal(area.data.get(WAITING).rows.length, 1);
  assert.equal((await lastWaiting(area, SETTINGS)).length, 1);
});

test("nothing is asked when Postulo is not set up, in testing, or not allowed", async () => {
  const fetchImpl = async () => assert.fail("asked");
  for (const [settings, allowed] of [
    [{ ...SETTINGS, instance: "" }, yes],
    [{ ...SETTINGS, token: "" }, yes],
    [{ ...SETTINGS, offline: true }, yes],
    [SETTINGS, async () => false],
  ]) {
    const result = await refreshWaiting({ area: memoryArea(), settings, allowed, fetchImpl });
    assert.equal(result.outcome, "skipped");
  }
});

test("a copy younger than the age asked is not read again", async () => {
  const area = memoryArea();
  await refreshWaiting({ area, settings: SETTINGS, allowed: yes, fetchImpl: postulo([]), now: () => 0 });
  const fetchImpl = async () => assert.fail("asked");
  const young = await refreshWaiting({ area, settings: SETTINGS, allowed: yes, fetchImpl, now: () => 59_000, maxAgeMs: 60_000 });
  assert.equal(young.outcome, "skipped");
  const old = await refreshWaiting({ area, settings: SETTINGS, allowed: yes, fetchImpl: postulo([]), now: () => 61_000, maxAgeMs: 60_000 });
  assert.equal(old.outcome, "read");
});

test("not set up, the copy is not counted", async () => {
  const area = memoryArea();
  await area.set({ [WAITING]: { at: "x", rows: [row(1, "https://example.org/1")] } });
  assert.deepEqual(await lastWaiting(area, { ...SETTINGS, token: "" }), []);
});
