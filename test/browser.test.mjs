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
const { readCurrentTab, tabProblem } = await import("../src/lib/browser.js");
const { Refusal } = await import("../src/lib/api.js");

test("a page the browser will not script is the translated 'unreadable', not the browser's message", async () => {
  await assert.rejects(readCurrentTab(), (error) => error instanceof Refusal && error.key === "unreadable");
});

test("the popup learns on opening that the tab is not a web page, and says nothing when it cannot tell", async () => {
  const tabs = globalThis.chrome.tabs;
  tabs.query = async () => [{ id: 1, url: "chrome://extensions/" }];
  assert.equal(await tabProblem(), "notWebPage");
  tabs.query = async () => [{ id: 1, url: "https://example.org/job" }];
  assert.equal(await tabProblem(), "");
  // No address readable (no grant yet): the press decides, as before.
  tabs.query = async () => [{ id: 1 }];
  assert.equal(await tabProblem(), "");
  tabs.query = async () => [];
  assert.equal(await tabProblem(), "");
});
