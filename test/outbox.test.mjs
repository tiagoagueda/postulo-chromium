// Runs with `node --test`: the captures kept in the browser, and sending them when Postulo answers.
import assert from "node:assert/strict";
import { test } from "node:test";

import { makeLog } from "../src/lib/log.js";
import { deliver } from "../src/lib/outbox.js";
import { makeStore } from "../src/lib/store.js";

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
    calls.push({ url, body: JSON.parse(init.body) });
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
