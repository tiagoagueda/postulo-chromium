// Runs with `node --test`: Send asks for the host permission from the click, and keeps the capture anyway.
import assert from "node:assert/strict";
import { test } from "node:test";

import { askAndKeep } from "../src/lib/allow.js";

/** Firefox's rule: a request made after anything was awaited is rejected. */
function strictPermissions(answer) {
  let clicked = true;
  return {
    calls: 0,
    async request() {
      this.calls += 1;
      if (!clicked) {
        throw new Error("permissions.request may only be called from a user input handler");
      }
      return answer;
    },
    afterAwait() {
      clicked = false;
    },
  };
}

test("the request starts before the capture is saved, and a refusal keeps the capture", async () => {
  const permissions = strictPermissions(false);
  let saved = null;
  const value = await askAndKeep(
    () => permissions.request(),
    async () => {
      permissions.afterAwait();
      saved = "waiting";
      return "record";
    },
  );
  assert.equal(permissions.calls, 1);
  assert.equal(saved, "waiting");
  assert.equal(value, "record");
});

test("a request that throws still keeps the capture", async () => {
  const value = await askAndKeep(
    () => {
      throw new Error("no");
    },
    async () => "record",
  );
  assert.equal(value, "record");
});

test("nothing to ask: the capture is kept", async () => {
  assert.equal(await askAndKeep(null, async () => 7), 7);
});

test("a failing save is reported", async () => {
  await assert.rejects(
    askAndKeep(() => Promise.resolve(true), async () => {
      throw new Error("disk");
    }),
    /disk/,
  );
});

test("the request is made before the work, even when the work needs an await to find what to keep", async () => {
  const order = [];
  await askAndKeep(
    () => {
      order.push("ask");
      return Promise.resolve(false);
    },
    async () => {
      order.push("keep");
      await Promise.resolve();
      return [];
    },
  );
  assert.deepEqual(order, ["ask", "keep"]);
});
