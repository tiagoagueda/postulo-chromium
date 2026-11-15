// Runs with `node --test`: the toolbar icon and tooltip from the settings and what is known of Postulo.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { CONNECTION, checkConnection, deliverAndRead, footerFor, learn, outcomeOfDelivery, stateOfFailure, toolbarFor, toolbarTitle } from "../src/lib/connection.js";

const SET = { instance: "https://p.example", token: "t", offline: false };
const record = (state, extra = {}) => ({ state, at: "2026-10-04T10:00:00Z", how: "send", tokenChecked: true, ...extra });

test("the icon is grey in every state but reachable, and says why in words", () => {
  const cases = [
    [{ ...SET, token: "" }, null, "unconfigured", "notConnected"],
    [{ ...SET, instance: "" }, record("reachable"), "unconfigured", "notConnected"],
    [{ ...SET, offline: true }, record("reachable"), "testing", "offlineOn"],
    [SET, record("noPermission"), "noPermission", "noPermission"],
    [SET, record("tokenRefused"), "tokenRefused", "tokenRefused"],
    [SET, record("unreachable"), "unreachable", "postuloUnreachable"],
  ];
  for (const [settings, known, state, reason] of cases) {
    const toolbar = toolbarFor(settings, known);
    assert.equal(toolbar.state, state);
    assert.equal(toolbar.grey, true, state);
    assert.equal(toolbar.reason, reason, state);
    assert.deepEqual(toolbar.icons, { 16: "icons/postulo-grey-16.png", 32: "icons/postulo-grey-32.png" });
  }
});

test("reachable, or not yet known, keeps the colour and has no reason", () => {
  for (const known of [record("reachable"), null, undefined]) {
    const toolbar = toolbarFor(SET, known);
    assert.deepEqual([toolbar.grey, toolbar.reason], [false, null]);
    assert.deepEqual(toolbar.icons, { 16: "icons/postulo-16.png", 32: "icons/postulo-32.png" });
  }
});

test("the testing switch greys the icon at once, whatever was learnt before", () => {
  assert.equal(toolbarFor({ ...SET, offline: true }, record("reachable")).grey, true);
  assert.equal(toolbarFor(SET, record("reachable")).grey, false);
});

test("every image the toolbar can name is in the source", () => {
  for (const settings of [SET, { ...SET, offline: true }]) {
    for (const path of Object.values(toolbarFor(settings, record("reachable")).icons)) {
      assert.ok(existsSync(new URL(`../src/${path}`, import.meta.url)), path);
    }
  }
});

test("the tooltip gives the reason, then the button's own words", () => {
  assert.equal(toolbarTitle("Reason.", "Capture"), "Reason. Capture");
  assert.equal(toolbarTitle(null, "Capture"), "Capture");
});

test("a failure is judged by whether Postulo answered", () => {
  assert.deepEqual(stateOfFailure({ status: 401 }), { state: "tokenRefused", tokenChecked: true });
  assert.deepEqual(stateOfFailure({ status: 403 }), { state: "tokenRefused", tokenChecked: true });
  assert.deepEqual(stateOfFailure({}), { state: "unreachable" });
  assert.deepEqual(stateOfFailure(new TypeError("Failed to fetch")), { state: "unreachable" });
  for (const status of [500, 502, 503]) {
    assert.deepEqual(stateOfFailure({ status }), { state: "unreachable" }, String(status));
  }
  // Busy is answering; refusing one capture is answering.
  assert.deepEqual(stateOfFailure({ status: 429 }), { state: "reachable" });
  assert.deepEqual(stateOfFailure({ status: 422 }), { state: "reachable", tokenChecked: true });
});

test("a delivery shows what it showed, and nothing when it asked nothing", () => {
  assert.deepEqual(outcomeOfDelivery({ outcome: "unreachable", status: 503 }), { state: "unreachable", how: "send" });
  assert.deepEqual(outcomeOfDelivery({ outcome: "unreachable", status: 429 }), { state: "reachable", how: "send" });
  assert.deepEqual(outcomeOfDelivery({ outcome: "unreachable" }), { state: "unreachable", how: "send" });
  assert.deepEqual(outcomeOfDelivery({ outcome: "account", status: 401 }), { state: "tokenRefused", tokenChecked: true, how: "send" });
  assert.deepEqual(outcomeOfDelivery({ outcome: "noPermission" }), { state: "noPermission", how: "send" });
  assert.deepEqual(outcomeOfDelivery({ outcome: "done", sent: 2 }), { state: "reachable", tokenChecked: true, how: "send" });
  for (const result of [{ outcome: "nothing" }, { outcome: "offline" }, { outcome: "unconfigured" }, { outcome: "done", sent: 0 }]) {
    assert.equal(outcomeOfDelivery(result), null, result.outcome);
  }
});

function memoryArea(start = {}) {
  const data = new Map(Object.entries(start));
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

/** A Postulo answering each path as told (a status, or an Error for no answer), recording what was asked. */
function postulo(answers, scopes = ["captures"]) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    const answer = answers[path];
    if (answer instanceof Error) {
      throw answer;
    }
    return new Response(JSON.stringify({ scopes }), { status: answer, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetchImpl };
}

const yes = async () => true;
const NOW = () => Date.parse("2026-10-04T12:00:00Z");

test("nothing is asked in testing or when not set up, and an absent permission is itself the answer", async () => {
  for (const settings of [{ ...SET, offline: true }, { ...SET, token: "" }, { ...SET, instance: "" }]) {
    const area = memoryArea();
    const { calls, fetchImpl } = postulo({});
    assert.equal(await checkConnection({ area, settings, allowed: yes, fetchImpl, now: NOW }), null);
    assert.equal(calls.length, 0);
    assert.equal(area.data.size, 0);
  }
  const area = memoryArea();
  const { calls, fetchImpl } = postulo({});
  const kept = await checkConnection({ area, settings: SET, allowed: async () => false, fetchImpl, now: NOW });
  assert.equal(kept.state, "noPermission");
  assert.equal(calls.length, 0);
});

test("the check is /healthz, with no token and no cookies, once the token's state is known", async () => {
  const area = memoryArea({ [CONNECTION]: record("unreachable") });
  const { calls, fetchImpl } = postulo({ "/healthz": 200 });
  const kept = await checkConnection({ area, settings: SET, allowed: yes, fetchImpl, now: NOW });
  assert.deepEqual(calls.map((call) => call.path), ["/healthz"]);
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(JSON.stringify(calls[0].init.headers).toLowerCase().includes("authorization"), false);
  assert.equal(kept.state, "reachable");
  assert.equal(kept.how, "healthz");
  assert.equal(kept.at, "2026-10-04T12:00:00.000Z");
  assert.deepEqual(area.data.get(CONNECTION), kept);
});

test("a refused token stays refused until a real call or a new token says otherwise", async () => {
  const area = memoryArea({ [CONNECTION]: record("tokenRefused") });
  const { calls, fetchImpl } = postulo({ "/healthz": 200 });
  const kept = await checkConnection({ area, settings: SET, allowed: yes, fetchImpl, now: NOW });
  assert.equal(kept.state, "tokenRefused");
  assert.equal(calls.length, 1);
});

test("a Postulo that does not answer, or answers 503, is unreachable", async () => {
  for (const answer of [new TypeError("Failed to fetch"), 503, 502]) {
    const area = memoryArea({ [CONNECTION]: record("reachable") });
    const { fetchImpl } = postulo({ "/healthz": answer });
    const kept = await checkConnection({ area, settings: SET, allowed: yes, fetchImpl, now: NOW });
    assert.equal(kept.state, "unreachable", String(answer));
    assert.equal(kept.tokenChecked, true, "the token was good when last tried and nothing says it is not");
  }
});

test("with the token not yet known, /me says it, after /healthz", async () => {
  const area = memoryArea();
  const { calls, fetchImpl } = postulo({ "/healthz": 200, "/api/v1/me": 200 });
  const kept = await checkConnection({ area, settings: SET, allowed: yes, fetchImpl, now: NOW });
  assert.deepEqual(calls.map((call) => call.path), ["/healthz", "/api/v1/me"]);
  assert.deepEqual([kept.state, kept.how, kept.tokenChecked], ["reachable", "me", true]);

  const refused = memoryArea();
  const second = postulo({ "/healthz": 200, "/api/v1/me": 401 });
  assert.equal((await checkConnection({ area: refused, settings: SET, allowed: yes, fetchImpl: second.fetchImpl, now: NOW })).state, "tokenRefused");
});

test("a /healthz that is blocked on the way (4xx) falls back to /me", async () => {
  const area = memoryArea({ [CONNECTION]: record("reachable") });
  const { calls, fetchImpl } = postulo({ "/healthz": 403, "/api/v1/me": 200 });
  const kept = await checkConnection({ area, settings: SET, allowed: yes, fetchImpl, now: NOW });
  assert.deepEqual(calls.map((call) => call.path), ["/healthz", "/api/v1/me"]);
  assert.equal(kept.state, "reachable");
});

test("a permission just given is checked with /me, not taken on trust", async () => {
  const area = memoryArea({ [CONNECTION]: record("noPermission", { tokenChecked: false }) });
  const { calls, fetchImpl } = postulo({ "/healthz": 200, "/api/v1/me": 200 });
  await checkConnection({ area, settings: SET, allowed: yes, fetchImpl, now: NOW });
  assert.equal(calls.length, 2);
});

test("what a call showed is kept with when and how; an unanswered call leaves the token's state alone", async () => {
  const area = memoryArea();
  await learn(area, { state: "reachable", tokenChecked: true, how: "send" }, NOW);
  const after = await learn(area, { state: "unreachable", how: "send" }, NOW);
  assert.deepEqual(after, { state: "unreachable", at: "2026-10-04T12:00:00.000Z", how: "send", tokenChecked: true });
  assert.equal((await learn(area, { state: "noPermission", how: "permission" }, NOW)).tokenChecked, false);
});

test("the footer names each state, and follows the toolbar: in colour exactly when online or slow", () => {
  const cases = [
    [SET, record("reachable", { ms: 120 }), "online", "footerOnline"],
    [SET, record("reachable", { ms: 1000 }), "online", "footerOnline"],
    [SET, record("reachable", { ms: 1001 }), "slow", "footerSlow"],
    [SET, record("reachable"), "online", "footerOnline"],
    [SET, record("unreachable"), "unreachable", "postuloUnreachable"],
    [SET, record("noPermission"), "noPermission", "noPermission"],
    [SET, record("tokenRefused"), "tokenRefused", "tokenRefused"],
    [{ ...SET, offline: true }, record("reachable", { ms: 5 }), "testing", "offlineOn"],
  ];
  for (const [settings, known, state, key] of cases) {
    const footer = footerFor(settings, known);
    assert.deepEqual(footer, { state, key });
    assert.equal(!toolbarFor(settings, known).grey, state === "online" || state === "slow", state);
  }
});

test("the footer shows nothing when not set up, or while nothing is known and nothing is late", () => {
  assert.equal(footerFor({ ...SET, token: "" }, record("reachable")), null);
  assert.equal(footerFor({ ...SET, instance: "" }, null, { slow: true }), null);
  assert.equal(footerFor(SET, null), null);
  assert.equal(footerFor(SET, undefined, {}), null);
});

test("a second without an answer is slow for a Postulo last seen answering or never seen, and changes no red or grey", () => {
  assert.equal(footerFor(SET, record("reachable", { ms: 50 }), { slow: true }).state, "slow");
  assert.equal(footerFor(SET, null, { slow: true }).state, "slow");
  assert.equal(footerFor(SET, record("unreachable"), { slow: true }).state, "unreachable");
  assert.equal(footerFor(SET, record("tokenRefused"), { slow: true }).state, "tokenRefused");
  assert.equal(footerFor({ ...SET, offline: true }, null, { slow: true }).state, "testing");
});

test("the check keeps how long /healthz took, and a failed one keeps none", async () => {
  const area = memoryArea();
  let at = 1000;
  const clock = () => at;
  const slowly = async () => {
    at += 1500;
    return { status: 200, ok: true, json: async () => ({}) };
  };
  const kept = await checkConnection({ area, settings: SET, allowed: async () => true, fetchImpl: slowly, now: clock });
  assert.equal(kept.ms >= 1500, true);
  assert.equal(footerFor(SET, kept).state, "slow");
  const refused = async () => {
    throw new TypeError("network");
  };
  const down = await checkConnection({ area: memoryArea(), settings: SET, allowed: async () => true, fetchImpl: refused, now: clock });
  assert.equal(down.state, "unreachable");
  assert.equal("ms" in down, false);
});

// ------------------------------------------------------------------ the background's beat (#53)

async function beat(delivered, checked) {
  const asked = [];
  await deliverAndRead({
    deliver: async () => {
      asked.push("deliver");
      return delivered;
    },
    check: async () => {
      asked.push("check");
      return checked === undefined ? null : { state: checked };
    },
    read: async () => {
      asked.push("read");
    },
  });
  return asked;
}

test("the list is read on a beat only when Postulo was not just found out of reach", async () => {
  const nothing = { outcome: "nothing", sent: 0 };
  assert.deepEqual(await beat(nothing, "reachable"), ["deliver", "check", "read"]);
  for (const state of ["unreachable", "noPermission", "tokenRefused"]) {
    assert.deepEqual(await beat(nothing, state), ["deliver", "check"], state);
  }
  // Not set up or the testing switch: the check says nothing and the read decides for itself.
  assert.deepEqual(await beat(nothing, undefined), ["deliver", "check", "read"]);
  // A send that failed has said it already: neither a check nor a read after it.
  assert.deepEqual(await beat({ outcome: "unreachable", sent: 0 }), ["deliver"]);
  assert.deepEqual(await beat({ outcome: "account", sent: 0 }), ["deliver"]);
  assert.deepEqual(await beat({ outcome: "noPermission", sent: 0 }), ["deliver"]);
  // Busy (429) is reachable: the list is still asked for.
  assert.deepEqual(await beat({ outcome: "unreachable", sent: 0, status: 429 }), ["deliver", "read"]);
  // Something sent: the delivery read the list already.
  assert.deepEqual(await beat({ outcome: "done", sent: 2 }), ["deliver"]);
});

test("what /me says of a token wider than captures is kept on the record, and none when it is not (SEC3-011)", async () => {
  const wide = postulo({ "/healthz": 200, "/api/v1/me": 200 }, ["captures", "read"]);
  const area = memoryArea();
  const kept = await checkConnection({ area, settings: SET, allowed: yes, fetchImpl: wide.fetchImpl, now: NOW });
  assert.deepEqual(kept.wide, ["read"]);

  const narrow = postulo({ "/healthz": 200, "/api/v1/me": 200 });
  const plain = await checkConnection({ area: memoryArea(), settings: SET, allowed: yes, fetchImpl: narrow.fetchImpl, now: NOW });
  assert.equal("wide" in plain, false);

  // A beat that only asks /healthz leaves it, until /me says otherwise.
  const again = await checkConnection({ area, settings: SET, allowed: yes, fetchImpl: narrow.fetchImpl, now: NOW });
  assert.deepEqual(again.wide, ["read"]);
});
