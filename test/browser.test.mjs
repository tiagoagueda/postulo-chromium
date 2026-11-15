// Runs with `node --test`: reading the current tab, with the browser's API stubbed.
import assert from "node:assert/strict";
import { test } from "node:test";

const kept = {};
globalThis.chrome = {
  storage: { local: { get: async () => ({ ...kept }) } },
  tabs: { query: async () => [{ id: 1, url: "https://chromewebstore.google.com/" }] },
  scripting: {
    executeScript: async () => {
      throw new Error("Cannot access contents of url");
    },
  },
};
const { loadSettings, readCurrentTab, tabProblem } = await import("../src/lib/browser.js");
const { Refusal } = await import("../src/lib/api.js");
const { deliver } = await import("../src/lib/outbox.js");

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

test("an address stored before the rules is not used: http to another machine, credentials (SEC3-010)", async () => {
  for (const [address, why] of [
    ["http://pi.local", "httpsOnly"],
    ["https://user:secret@postulo.example.org", "noCredentialsInAddress"],
  ]) {
    kept.instance = address;
    kept.token = "tok";
    const settings = await loadSettings();
    assert.equal(settings.instance, "");
    assert.equal(settings.refused, why);
    assert.equal(settings.stored, address, "the form still shows what is kept, to correct it");

    let asked = 0;
    const store = {
      list: async () => [{ id: "a", state: "waiting", url: "https://example.org/job" }],
    };
    const log = { batch: () => ({ add: async () => {}, flush: async () => {} }) };
    const result = await deliver({
      store,
      log,
      settings,
      allowed: async () => true,
      fetchImpl: async () => {
        asked += 1;
        throw new Error("no request may be made");
      },
      lock: (work) => work(),
    });
    assert.equal(result.outcome, "unconfigured");
    assert.equal(asked, 0);
  }
  kept.instance = "https://postulo.example.org/";
  const fine = await loadSettings();
  assert.equal(fine.instance, "https://postulo.example.org");
  assert.equal(fine.refused, "");
});
