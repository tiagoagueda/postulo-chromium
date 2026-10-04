// Runs with `node --test`: the review window is opened once and brought forward after.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.chrome = { runtime: { getURL: (path) => `chrome-extension://x/${path}` } };
const { openInReviewWindow, reviewPageUrl } = await import("../src/lib/window.js");

/** A browser with windows, recording what was asked of it. */
function browser({ session = true, windows = true } = {}) {
  const calls = [];
  const memory = new Map();
  const open = new Map();
  const area = {
    get: async (key) => (memory.has(key) ? { [key]: memory.get(key) } : {}),
    set: async (items) => Object.entries(items).forEach(([key, value]) => memory.set(key, value)),
  };
  const api = {
    runtime: { getURL: (path) => `chrome-extension://x/${path}` },
    storage: session ? { session: area, local: { get: async () => assert.fail("local used"), set: async () => assert.fail("local used") } } : { local: area },
    tabs: {
      create: async (options) => calls.push(["tabs.create", options]),
      update: async (id, options) => calls.push(["tabs.update", id, options]),
    },
  };
  if (windows) {
    api.windows = {
      create: async (options) => {
        calls.push(["windows.create", options]);
        open.set(7, { id: 7, type: options.type, state: "normal", tabs: [{ id: 70, active: true }] });
        return { id: 7 };
      },
      get: async (id) => {
        if (!open.has(id)) {
          throw new Error("No window with id");
        }
        return open.get(id);
      },
      update: async (id, options) => calls.push(["windows.update", id, options]),
    };
  }
  return { api, calls, open };
}

test("the first review opens a popup window of a size, and the second reuses it", async () => {
  const { api, calls } = browser();
  await openInReviewWindow("https://a.example/", api);
  assert.deepEqual(calls, [["windows.create", { url: "https://a.example/", type: "popup", width: 760, height: 780 }]]);
  calls.length = 0;
  await openInReviewWindow("https://b.example/", api);
  assert.deepEqual(calls, [
    ["tabs.update", 70, { url: "https://b.example/", active: true }],
    ["windows.update", 7, { focused: true }],
  ]);
});

test("a window the person closed is opened again; a minimised one is restored", async () => {
  const { api, calls, open } = browser();
  await openInReviewWindow("https://a.example/", api);
  open.get(7).state = "minimized";
  calls.length = 0;
  await openInReviewWindow("https://b.example/", api);
  assert.deepEqual(calls[1], ["windows.update", 7, { focused: true, state: "normal" }]);
  open.delete(7);
  calls.length = 0;
  await openInReviewWindow("https://c.example/", api);
  assert.equal(calls[0][0], "windows.create");
});

test("an id that now belongs to a normal window is not hijacked", async () => {
  const { api, calls, open } = browser({ session: false });
  await openInReviewWindow("https://a.example/", api);
  open.get(7).type = "normal";
  calls.length = 0;
  await openInReviewWindow("https://b.example/", api);
  assert.equal(calls[0][0], "windows.create");
});

test("a browser without windows gets a tab", async () => {
  const { api, calls } = browser({ windows: false });
  await openInReviewWindow("https://a.example/", api);
  assert.deepEqual(calls, [["tabs.create", { url: "https://a.example/" }]]);
});

test("the page for a capture carries its id, and whether it was found again", () => {
  assert.equal(reviewPageUrl("a b"), "chrome-extension://x/review.html?id=a+b");
  assert.equal(reviewPageUrl("1", { again: true }), "chrome-extension://x/review.html?id=1&again=1");
  assert.equal(reviewPageUrl("1", { tab: { tabId: 4, windowId: 2 } }), "chrome-extension://x/review.html?id=1&tab=4&window=2");
  assert.equal(reviewPageUrl("1", { tab: { tabId: "x", windowId: 2 } }), "chrome-extension://x/review.html?id=1");
});
