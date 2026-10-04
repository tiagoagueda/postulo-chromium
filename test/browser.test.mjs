// Runs with `node --test`: reading the current tab, with the browser's API stubbed.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.chrome = {
  tabs: { query: async () => [{ id: 1, url: "https://chromewebstore.google.com/" }] },
  scripting: {
    executeScript: async () => {
      throw new Error("Cannot access contents of url");
    },
  },
};
const { readCurrentTab } = await import("../src/lib/browser.js");
const { Refusal } = await import("../src/lib/api.js");

test("a page the browser will not script is the translated 'unreadable', not the browser's message", async () => {
  await assert.rejects(readCurrentTab(), (error) => error instanceof Refusal && error.key === "unreadable");
});
