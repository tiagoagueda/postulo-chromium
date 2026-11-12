// Runs with `node --test`: the captures kept in the browser, and sending them when Postulo answers.
import assert from "node:assert/strict";
import { test } from "node:test";

import { makeLog } from "../src/lib/log.js";
import { afterDelivery, deliver, exclusively } from "../src/lib/outbox.js";
import { isCaptureKey, makeStore } from "../src/lib/store.js";
import { coalesce } from "../src/lib/waiting.js";

/** storage.local's shape, in memory: get a key or a list of keys, set many, remove some. */
function memoryArea() {
  const data = new Map();
  const copy = (value) => (value === undefined ? value : structuredClone(value));
  return {
    data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => data.has(key)).map((key) => [key, copy(data.get(key))]));
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        data.set(key, copy(value));
      }
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        data.delete(key);
      }
    },
  };
}

function setUp() {
  const area = memoryArea();
  let clock = 0;
  let serial = 0;
  const now = () => new Date(Date.UTC(2026, 8, 11, 9, 0, clock++)).toISOString();
  const store = makeStore(area, { now, newId: () => `c${++serial}` });
  const log = makeLog(area, { now });
  return { area, store, log };
}

const POSTING = (title) => ({
  title,
  company_name: "Black Mesa",
  location: "Lyon",
  remote_type: "",
  employment_type: "",
  description: "",
  salary_min: null,
  salary_max: null,
  salary_currency: "",
  salary_period: "",
  posted_at: null,
  closes_at: null,
  url: `https://jobs.example/${title}`,
  source: "jobs.example",
});

async function keep(store, title, state = "kept") {
  return store.add({ url: `https://jobs.example/${title}`, html: `<title>${title}</title>`, source: "schema.org", read: POSTING(title), data: POSTING(title), state });
}

const SETTINGS = { instance: "https://postulo.example.org", token: "tok", offline: false };
const noLock = (work) => work();
const allowed = async () => true;

function answering(...responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return { ok: next.status < 300, status: next.status, json: async () => next.body ?? null };
  };
  return { calls, fetchImpl };
}

// ------------------------------------------------------------------ the store

test("captures are listed newest first, and a page is kept apart from its record", async () => {
  const { area, store } = setUp();
  const first = await keep(store, "first");
  const second = await keep(store, "second");
  assert.deepEqual((await store.list()).map((record) => record.id), [second.id, first.id]);
  assert.equal(await store.page(first.id), "<title>first</title>");
  assert.ok(!("html" in (await store.get(first.id))), "the record does not carry the page");
  assert.ok(area.data.has(`page:${first.id}`));
});

test("an unsent capture of the same address is found, a sent one is not", async () => {
  const { store } = setUp();
  const record = await keep(store, "a");
  assert.equal((await store.unsentFor("https://jobs.example/a")).id, record.id);
  await store.update(record.id, { state: "sent" });
  assert.equal(await store.unsentFor("https://jobs.example/a"), null);
  assert.equal(await store.unsentCount(), 0);
});

test("deleting a capture deletes its page too", async () => {
  const { area, store } = setUp();
  const record = await keep(store, "gone");
  await store.remove(record.id);
  assert.deepEqual(await store.list(), []);
  assert.ok(!area.data.has(`page:${record.id}`) && !area.data.has(`capture:${record.id}`));
});

test("several captures from one page share the page, the last of them the newest", async () => {
  const { area, store } = setUp();
  const [a, b] = await store.addMany({
    html: "<title>results</title>",
    entries: ["1", "2"].map((n) => ({ url: `https://jobs.example/${n}`, source: "schema.org", read: POSTING(n), data: POSTING(n) })),
    state: "waiting",
  });
  assert.equal(a.pageId, a.id);
  assert.equal(b.pageId, a.id);
  assert.deepEqual(a.batch, { id: a.id, size: 2, position: 1 });
  assert.deepEqual(b.batch, { id: a.id, size: 2, position: 2 });
  assert.equal([...area.data.keys()].filter((key) => key.startsWith("page:")).length, 1, "one page for two");
  assert.equal(await store.page(b.id), "<title>results</title>");
  // Newest first, as everything is listed; so oldest-first delivery sends a before b.
  assert.deepEqual((await store.list()).map((record) => record.id), [b.id, a.id]);
  assert.equal(await store.unsentCount(), 2);
});

test("a shared page stays until the last capture read from it has gone", async () => {
  const { store } = setUp();
  const [a, b] = await store.addMany({
    html: "<title>results</title>",
    entries: ["1", "2"].map((n) => ({ url: `https://jobs.example/${n}`, source: "schema.org", read: POSTING(n), data: POSTING(n) })),
    state: "waiting",
  });
  await store.update(a.id, { state: "sent" });
  await store.dropPage(a.id);
  assert.equal(await store.page(b.id), "<title>results</title>", "still needed by the other");
  await store.remove(b.id);
  assert.equal(await store.page(a.id), "", "nothing needs it now");
  assert.deepEqual((await store.list()).map((record) => record.id), [a.id]);
});

test("deleting one of several leaves the page for the others", async () => {
  const { store } = setUp();
  const [a, b] = await store.addMany({
    html: "<title>results</title>",
    entries: ["1", "2"].map((n) => ({ url: `https://jobs.example/${n}`, source: "schema.org", read: POSTING(n), data: POSTING(n) })),
  });
  await store.remove(a.id);
  assert.equal(await store.page(b.id), "<title>results</title>");
  assert.equal(await store.get(a.id), null);
});

// ------------------------------------------------------------------ delivery

test("only what somebody said to send is sent, oldest first, with everything they reviewed", async () => {
  const { store, log } = setUp();
  await keep(store, "kept only");
  const older = await keep(store, "older", "waiting");
  const newer = await keep(store, "newer", "waiting");
  const { calls, fetchImpl } = answering(
    { status: 201, body: { id: 7, review_url: "https://postulo.example.org/r/7" } },
    { status: 201, body: { id: 8, review_url: "https://postulo.example.org/r/8" } },
  );

  const result = await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });

  assert.deepEqual(result, { outcome: "done", sent: 2 });
  assert.deepEqual(calls.map((call) => call.body.data.title), ["older", "newer"]);
  assert.equal(calls[0].url, "https://postulo.example.org/api/v1/captures");
  assert.deepEqual(calls[0].body, { url: older.url, html: "<title>older</title>", data: POSTING("older") });
  const sent = await store.get(newer.id);
  assert.equal(sent.state, "sent");
  assert.equal(sent.reviewUrl, "https://postulo.example.org/r/8");
  assert.equal(await store.page(newer.id), "", "Postulo has the page; the browser need not");
  assert.equal((await store.list()).find((record) => record.data.title === "kept only").state, "kept");
});

test("a batch goes as the one page with each posting's own address and place, and the page goes after the last", async () => {
  const { area, store, log } = setUp();
  const records = await store.addMany({
    html: "<title>results</title>",
    entries: ["1", "2", "3"].map((n) => ({ url: `https://jobs.example/${n}`, source: "schema.org", read: POSTING(n), data: POSTING(n) })),
    state: "waiting",
  });
  const { calls, fetchImpl } = answering(
    ...records.map((record, i) => ({ status: 201, body: { id: 10 + i, review_url: `https://postulo.example.org/r/${i}` } })),
  );
  const result = await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
  assert.equal(result.outcome, "done");
  assert.equal(result.sent, 3);
  assert.deepEqual(
    calls.map((call) => [call.body.url, call.body.html, call.body.batch]),
    [
      ["https://jobs.example/1", "<title>results</title>", { size: 3, position: 1 }],
      ["https://jobs.example/2", "<title>results</title>", { size: 3, position: 2 }],
      ["https://jobs.example/3", "<title>results</title>", { size: 3, position: 3 }],
    ],
  );
  assert.equal([...area.data.keys()].filter((key) => key.startsWith("page:")).length, 0, "the page has gone");
  assert.ok((await store.list()).every((record) => record.state === "sent"));
});

test("with Postulo unreachable, nothing is lost and nothing more is tried", async () => {
  const { store, log } = setUp();
  const first = await keep(store, "first", "waiting");
  const second = await keep(store, "second", "waiting");
  const { calls, fetchImpl } = answering(new TypeError("Failed to fetch"));

  const result = await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });

  assert.equal(result.outcome, "unreachable");
  assert.equal(calls.length, 1, "a server that is down is not asked once per capture");
  assert.equal((await store.get(first.id)).state, "waiting");
  assert.equal((await store.get(second.id)).state, "waiting");
  assert.equal(await store.page(first.id), "<title>first</title>");
});

test("a busy or failing Postulo is tried again later, like one that is down", async () => {
  for (const status of [429, 502, 503]) {
    const { store, log } = setUp();
    const record = await keep(store, "x", "waiting");
    const { fetchImpl } = answering({ status, body: {} });
    const result = await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
    assert.equal(result.outcome, "unreachable", String(status));
    assert.equal((await store.get(record.id)).state, "waiting", String(status));
  }
});

test("a refused token keeps the captures waiting: it is the account's problem, not theirs", async () => {
  const { store, log } = setUp();
  const record = await keep(store, "x", "waiting");
  const { fetchImpl } = answering({ status: 401, body: {} });
  const result = await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
  assert.equal(result.outcome, "account");
  assert.equal(result.problem.key, "tokenRefused");
  assert.equal((await store.get(record.id)).state, "waiting");
});

test("a capture Postulo refuses is marked so, and the rest still go", async () => {
  const { store, log } = setUp();
  const bad = await keep(store, "bad", "waiting");
  const good = await keep(store, "good", "waiting");
  const { fetchImpl } = answering(
    { status: 422, body: { detail: [{ loc: ["body", "payload", "data", "title"], msg: "Value error, A posting needs a title." }] } },
    { status: 201, body: { id: 9, review_url: "https://postulo.example.org/r/9" } },
  );
  const result = await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
  assert.deepEqual(result, { outcome: "done", sent: 1 });
  const refused = await store.get(bad.id);
  assert.equal(refused.state, "refused");
  assert.equal(refused.problem.message, "title: Value error, A posting needs a title.");
  assert.equal((await store.get(good.id)).state, "sent");
});

test("nothing is sent without a Postulo, with the testing switch on, or without permission", async () => {
  for (const [settings, permission, outcome] of [
    [{ instance: "", token: "", offline: false }, true, "unconfigured"],
    [{ ...SETTINGS, offline: true }, true, "offline"],
    [SETTINGS, false, "noPermission"],
  ]) {
    const { store, log } = setUp();
    const record = await keep(store, "x", "waiting");
    const { calls, fetchImpl } = answering();
    const result = await deliver({ store, log, settings, allowed: async () => permission, fetchImpl, lock: noLock });
    assert.equal(result.outcome, outcome);
    assert.equal(calls.length, 0, `${outcome}: nothing was to be asked`);
    assert.equal((await store.get(record.id)).state, "waiting");
  }
});

test("sending one capture leaves the others where they are", async () => {
  const { store, log } = setUp();
  const one = await keep(store, "one", "waiting");
  const other = await keep(store, "other", "waiting");
  const { calls, fetchImpl } = answering({ status: 201, body: { id: 1, review_url: "r" } });
  await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, only: [one.id], lock: noLock });
  assert.equal(calls.length, 1);
  assert.equal((await store.get(other.id)).state, "waiting");
});

test("two deliveries at once send each capture once", async () => {
  const { store, log } = setUp();
  await keep(store, "once", "waiting");
  const { calls, fetchImpl } = answering({ status: 201, body: { id: 1, review_url: "r" } }, { status: 201, body: { id: 2, review_url: "r" } });
  let queue = Promise.resolve();
  const lock = (work) => (queue = queue.then(work));
  await Promise.all([
    deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock }),
    deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock }),
  ]);
  assert.equal(calls.length, 1);
});

// ------------------------------------------------------------------ the log

test("the log keeps what happened, and never the token or the page", async () => {
  const { store, log } = setUp();
  await keep(store, "x", "waiting");
  const { fetchImpl } = answering({ status: 201, body: { id: 3, review_url: "r" } });
  await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
  const text = await log.text({ extension: "0.1.0" });
  assert.match(text, /^Postulo browser extension: log\nextension: 0\.1\.0\n/);
  assert.match(text, /send id=c1 host=jobs\.example/);
  assert.match(text, /sent id=c1 capture=3/);
  assert.match(text, /delivery outcome=done sent=1/);
  assert.ok(!text.includes("tok") && !text.includes("<title>"), "no token, no page");
});

test("the log keeps the latest thousand entries", async () => {
  const { log } = setUp();
  for (let i = 0; i < 1005; i += 1) {
    await log.add("tick", { i });
  }
  const entries = await log.entries();
  assert.equal(entries.length, 1000);
  assert.equal(entries[0].i, 5);
});

test("a capture is sent without the fragment of its address", async () => {
  const { store, log } = setUp();
  const address = `https://jobs.example/search?q=x#${"f".repeat(600)}`;
  await store.add({ url: address, html: "<title>x</title>", source: "schema.org", read: POSTING("x"), data: POSTING("x"), state: "waiting" });
  const { calls, fetchImpl } = answering({ status: 201, body: { id: 1, review_url: "https://postulo.example.org/r/1" } });
  await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
  assert.equal(calls[0].body.url, "https://jobs.example/search?q=x");
});

test("a record sent again after a lost answer repeats its Idempotency-Key, and an edit changes it", async () => {
  const { store, log } = setUp();
  const record = await keep(store, "again", "waiting");
  const { calls, fetchImpl } = answering(new TypeError("Failed to fetch"), new TypeError("Failed to fetch"), { status: 201, body: { id: 1, review_url: "r" } });
  await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
  await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
  assert.ok(calls[0].headers["Idempotency-Key"]);
  assert.equal(calls[1].headers["Idempotency-Key"], calls[0].headers["Idempotency-Key"]);
  await store.update(record.id, { data: { ...POSTING("again"), title: "edited" } });
  await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
  assert.notEqual(calls[2].headers["Idempotency-Key"], calls[0].headers["Idempotency-Key"]);
});

test("a delivery answered 200 with a page that is not JSON leaves the capture waiting with a translatable problem", async () => {
  const { store, log } = setUp();
  const record = await keep(store, "first", "waiting");
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } });

  const result = await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });

  assert.equal(result.outcome, "unreachable");
  const kept = await store.get(record.id);
  assert.equal(kept.state, "waiting");
  assert.deepEqual(kept.problem, { key: "notPostulo", substitutions: [] });
});

test("a full storage quota reaches the caller as a message that can be translated", async () => {
  const { area, store } = setUp();
  area.set = async () => {
    throw new Error("QuotaExceededError: Resource::kQuotaBytes quota exceeded");
  };
  await assert.rejects(store.add({ url: "https://x.test/1", html: "<p>", source: "s", read: {}, data: {} }), { key: "storageFull" });
  await assert.rejects(store.addMany({ html: "<p>", entries: [{ url: "u", source: "s", read: {}, data: {} }] }), { key: "storageFull" });
});

test("what Postulo said about a picture of the page is kept with a sent capture, and only the offer", async () => {
  const { store, log } = setUp();
  const record = await keep(store, "one", "waiting");
  const page = {
    source: true,
    accepts_rendering: true,
    rendering_url: "https://postulo.example.org/api/v1/captures/7/rendering",
    rendering_types: ["image/png"],
    rendering_max_bytes: 100,
  };
  const { fetchImpl } = answering({ status: 201, body: { id: 7, review_url: "https://postulo.example.org/r/7", page } });
  await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
  const { source, ...offer } = page;
  assert.deepEqual((await store.get(record.id)).page, offer);

  const older = await keep(store, "older server", "waiting");
  const { fetchImpl: again } = answering({ status: 201, body: { id: 8, review_url: "https://postulo.example.org/r/8" } });
  await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl: again, lock: noLock });
  assert.equal((await store.get(older.id)).page, null, "an older server sends none, and nothing more is sent");
});

test("an address still over Postulo's limit once its fragment is gone is not sent, and says why", async () => {
  const { store, log } = setUp();
  const long = `https://jobs.example/search?q=${"a".repeat(600)}#top`;
  const stuck = await store.add({ url: long, html: "<title>x</title>", source: "schema.org", read: POSTING("x"), data: POSTING("x"), state: "waiting" });
  const fine = await keep(store, "y", "waiting");
  const { calls, fetchImpl } = answering({ status: 201, body: { id: 2, review_url: "https://postulo.example.org/r/2" } });
  const result = await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
  assert.equal(calls.length, 1, "only the capture with an address that fits is asked about");
  assert.equal(calls[0].body.url, "https://jobs.example/y");
  assert.deepEqual(result, { outcome: "done", sent: 1 });
  const refused = await store.get(stuck.id);
  assert.equal(refused.state, "refused");
  assert.deepEqual(refused.problem, { key: "addressTooLong", substitutions: [] });
  assert.equal((await store.get(fine.id)).state, "sent");
  assert.ok((await log.entries()).some((entry) => entry.event === "failed" && entry.id === stuck.id && entry.status === "not sent"));
});

test("an address that is empty, as tidy leaves one that was too long, is not sent either", async () => {
  const { store, log } = setUp();
  const nothing = await store.add({ url: "", html: "<title>x</title>", source: "schema.org", read: POSTING("x"), data: POSTING("x"), state: "waiting" });
  const { calls, fetchImpl } = answering();
  await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
  assert.equal(calls.length, 0);
  assert.equal((await store.get(nothing.id)).problem.key, "addressTooLong");
});

test("an address of exactly the limit is sent", async () => {
  const { store, log } = setUp();
  const address = `https://jobs.example/${"a".repeat(500 - "https://jobs.example/".length)}`;
  assert.equal(address.length, 500);
  await store.add({ url: address, html: "<title>x</title>", source: "schema.org", read: POSTING("x"), data: POSTING("x"), state: "waiting" });
  const { calls, fetchImpl } = answering({ status: 201, body: { id: 1, review_url: "https://postulo.example.org/r/1" } });
  await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.url, address);
});

// ------------------------------------------------------------------ what a sent capture keeps (#54)

/** Count the writes that touch one key of the area. */
function countingWrites(area, key) {
  const counted = { writes: 0 };
  const set = area.set.bind(area);
  area.set = async (items) => {
    if (key in items) {
      counted.writes += 1;
    }
    return set(items);
  };
  return counted;
}

test("a sent capture keeps only what the lists show of it, and the way back to Postulo", async () => {
  const { area, store, log } = setUp();
  const record = await keep(store, "slim", "waiting");
  await store.update(record.id, { data: { ...POSTING("slim"), description: "x".repeat(20_000) } });
  const { fetchImpl } = answering({ status: 201, body: { id: 7, review_url: "https://postulo.example.org/r/7" } });
  await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });

  const sent = await store.get(record.id);
  assert.equal(sent.state, "sent");
  assert.equal(sent.read, null, "the reading is Postulo's now");
  assert.deepEqual(sent.data, { title: "slim", company_name: "Black Mesa", location: "Lyon", url: "https://jobs.example/slim" });
  assert.equal(sent.reviewUrl, "https://postulo.example.org/r/7");
  assert.ok(JSON.stringify(area.data.get(`capture:${record.id}`)).length < 1000, "a few hundred bytes, not the description");
});

test("sent captures past their days are removed, older ones slimmed, and nothing unsent is touched", async () => {
  const { area, store } = setUp();
  const old = await keep(store, "old");
  const fat = await keep(store, "fat");
  const kept = await keep(store, "kept");
  const [first, second] = await store.addMany({
    html: "<title>results</title>",
    entries: ["1", "2"].map((n) => ({ url: `https://jobs.example/${n}`, source: "schema.org", read: POSTING(n), data: POSTING(n) })),
    state: "waiting",
  });
  // Sent before captures were slimmed on sending: the whole reading still there.
  await store.update(old.id, { state: "sent", sentAt: "2026-07-01T00:00:00.000Z" });
  await store.update(fat.id, { state: "sent", sentAt: "2026-09-01T00:00:00.000Z" });
  // The first of a batch, under whose id the page of the batch is kept, sent long ago.
  await store.update(first.id, { state: "sent", sentAt: "2026-07-01T00:00:00.000Z" });

  const done = await store.tidySent({ before: "2026-08-01T00:00:00.000Z" });

  assert.deepEqual(done, { removed: 2, slimmed: 1 });
  assert.deepEqual((await store.list()).map((record) => record.id), [second.id, kept.id, fat.id]);
  assert.ok(!area.data.has(`capture:${old.id}`) && !area.data.has(`capture:${first.id}`));
  assert.deepEqual((await store.get(fat.id)).data, { title: "fat", company_name: "Black Mesa", location: "Lyon", url: "https://jobs.example/fat" });
  assert.deepEqual((await store.get(kept.id)).data, POSTING("kept"), "a kept capture keeps everything");
  assert.equal(await store.page(second.id), "<title>results</title>", "the batch's page stays for the one still to go");
  assert.deepEqual(await store.tidySent({ before: "2026-08-01T00:00:00.000Z" }), { removed: 0, slimmed: 0 }, "nothing more to do");
});

test("a delivery writes the log once, however many captures it sends", async () => {
  const { area, store, log } = setUp();
  for (const title of ["a", "b", "c", "d", "e"]) {
    await keep(store, title, "waiting");
  }
  const counted = countingWrites(area, "log");
  const { fetchImpl } = answering(...[1, 2, 3, 4, 5].map((id) => ({ status: 201, body: { id, review_url: `r${id}` } })));
  const result = await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });

  assert.equal(result.sent, 5);
  assert.equal(counted.writes, 1);
  const events = (await log.entries()).map((entry) => entry.event);
  assert.deepEqual(events, [...Array(5)].flatMap(() => ["send", "sent"]).concat("delivery"));
  const stamps = (await log.entries()).map((entry) => entry.at);
  assert.deepEqual([...stamps].sort(), stamps, "each stamped when it happened, in order");
});

test("a delivery that stops early still writes what it noted, once", async () => {
  const { area, store, log } = setUp();
  await keep(store, "a", "waiting");
  await keep(store, "b", "waiting");
  const counted = countingWrites(area, "log");
  const { fetchImpl } = answering({ status: 201, body: { id: 1, review_url: "r" } }, new TypeError("Failed to fetch"));
  const result = await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: noLock });

  assert.equal(result.outcome, "unreachable");
  assert.equal(counted.writes, 1);
  assert.deepEqual((await log.entries()).map((entry) => entry.event), ["send", "sent", "send", "failed", "delivery"]);
});

test("the log never throws, written one entry or several at a time", async () => {
  const { area, log } = setUp();
  area.set = async () => {
    throw new Error("QuotaExceededError");
  };
  await log.add("x");
  await log.addMany([{ at: "t", event: "y" }]);
  const journal = log.batch();
  journal.add("z");
  await journal.flush();
});

// ------------------------------------------------------------------ reading less while sending (#53)

/** Count the capture records read from the area. */
function countingRecordReads(area) {
  const counted = { records: 0 };
  const get = area.get.bind(area);
  area.get = async (keys) => {
    counted.records += (Array.isArray(keys) ? keys : [keys]).filter((key) => key.startsWith("capture:")).length;
    return get(keys);
  };
  return counted;
}

test("dropping a sent capture's page reads its batch's neighbours, not every capture", async () => {
  const { area, store } = setUp();
  for (let i = 0; i < 100; i += 1) {
    await keep(store, `other${i}`);
  }
  const [a, b, c] = await store.addMany({
    html: "<title>results</title>",
    entries: ["1", "2", "3"].map((n) => ({ url: `https://jobs.example/${n}`, source: "schema.org", read: POSTING(n), data: POSTING(n) })),
    state: "waiting",
  });
  await keep(store, "after");
  const single = await keep(store, "single", "waiting");
  const counted = countingRecordReads(area);

  await store.update(c.id, { state: "sent" });
  await store.dropPage(c.id);
  assert.equal(await store.page(a.id), "<title>results</title>", "still needed by the first two");
  await store.update(a.id, { state: "sent" });
  await store.dropPage(a.id);
  assert.equal(await store.page(b.id), "<title>results</title>", "still needed by the second");
  await store.update(b.id, { state: "sent" });
  await store.dropPage(b.id);
  assert.equal(await store.page(b.id), "", "gone with the last of them");
  await store.update(single.id, { state: "sent" });
  await store.dropPage(single.id);
  assert.ok(!area.data.has(`page:${single.id}`));

  // Each update and each page() reads its record once, each drop its own and at most
  // 2 × (size − 1) neighbours; listing every capture would read 105 per drop.
  assert.ok(counted.records <= 4 + 3 + 4 + 3 * 4, `${counted.records} records read`);
});

/** The Web Locks the extension runs under (`navigator.locks`), in memory: one lock, held
 *  exclusively or shared, granted in the order asked. Node has no `navigator.locks` before
 *  24, where `exclusively` and `afterDelivery` would run at once, so the test brings its own
 *  rather than depending on the Node it runs on. */
function webLocks() {
  const queue = [];
  const held = [];
  const grant = () => {
    while (queue.length) {
      const next = queue[0];
      const free = next.mode === "shared" ? held.every((mode) => mode === "shared") : !held.length;
      if (!free) {
        return;
      }
      queue.shift();
      held.push(next.mode);
      Promise.resolve()
        .then(next.work)
        .then(next.resolve, next.reject)
        .finally(() => {
          held.splice(held.indexOf(next.mode), 1);
          grant();
        });
    }
  };
  return {
    request(name, options, work) {
      if (typeof options === "function") {
        [work, options] = [options, {}];
      }
      return new Promise((resolve, reject) => {
        queue.push({ mode: options.mode || "exclusive", work, resolve, reject });
        grant();
      });
    },
  };
}

test("a delivery of forty is recounted once on the toolbar, at its end", async () => {
  const { area, store, log } = setUp();
  const locks = webLocks();
  for (let i = 0; i < 40; i += 1) {
    await keep(store, `p${i}`, "waiting");
  }
  // The background's listener, over the area: a recount for each change of a capture key.
  const counts = [];
  const recount = coalesce(async () => counts.push(await store.unsentCount()), (run) => afterDelivery(run, locks));
  const pending = [];
  const set = area.set.bind(area);
  const remove = area.remove.bind(area);
  const changed = (keys) => {
    if (keys.some(isCaptureKey)) {
      pending.push(recount());
    }
  };
  area.set = async (items) => {
    await set(items);
    changed(Object.keys(items));
  };
  area.remove = async (keys) => {
    await remove(keys);
    changed(Array.isArray(keys) ? keys : [keys]);
  };
  let id = 0;
  const fetchImpl = async () => {
    // An answer that takes a few turns, so a recount could run between two captures.
    for (let turn = 0; turn < 10; turn += 1) {
      await null;
    }
    id += 1;
    return { ok: true, status: 201, json: async () => ({ id, review_url: `r${id}` }) };
  };

  const result = await deliver({ store, log, settings: SETTINGS, allowed, fetchImpl, lock: (work) => exclusively(work, locks) });
  await Promise.all(pending);

  assert.equal(result.sent, 40);
  assert.ok(pending.length >= 40, `${pending.length} changes`);
  assert.deepEqual(counts, [0], "one recount, after the last capture was sent");
});
