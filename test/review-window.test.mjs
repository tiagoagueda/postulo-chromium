// Runs with `node --test`: the page a capture is reviewed in -- the form for one kept
// capture, which Keep and Delete act on.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { JSDOM } from "jsdom";

test("the review page shows the capture it is given, keeps what was corrected, and deletes", async () => {
  const dom = new JSDOM(readFileSync(new URL("../src/review.html", import.meta.url), "utf8"), { url: "chrome-extension://x/review.html?id=a&again=1" });
  const data = new Map();
  const area = {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => data.has(key)).map((key) => [key, structuredClone(data.get(key))]));
    },
    async set(items) {
      Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value)));
    },
    async remove(keys) {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => data.delete(key));
    },
  };
  const posting = { title: "Engineer", company_name: "Acme", location: "Lisbon", salary_currency: "" };
  data.set("captures", ["a"]);
  data.set("capture:a", { id: "a", url: "https://example.test/a", source: "schema.org", read: posting, data: posting, state: "kept", capturedAt: "2026-01-01T00:00:00Z" });
  data.set("page:a", "<html></html>");
  const removed = [];
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.location = dom.window.location;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Option = dom.window.Option;
  globalThis.chrome = {
    i18n: { getMessage: (key) => (key === "languageTag" ? "en" : key) },
    storage: { local: area, onChanged: { addListener() {} } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}, setIcon: async () => {} },
    runtime: { openOptionsPage() {} },
    permissions: { contains: async () => false, request: async () => true },
    windows: { getCurrent: async () => ({ id: 9, type: "popup" }), remove: async (id) => removed.push(id) },
  };
  dom.window.confirm = () => true;
  await import("../src/review.js");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  await settle();
  const $ = (id) => dom.window.document.getElementById(id);

  assert.equal($("edit").hidden, false);
  assert.equal($("edit-hint").textContent, "alreadyKept");
  assert.equal($("edit-read-by").textContent, "readBy");
  assert.equal(dom.window.document.querySelector('[name="title"]').value, "Engineer");

  dom.window.document.querySelector('[name="title"]').value = "Senior engineer";
  $("keep").click();
  await settle();
  assert.equal(data.get("capture:a").data.title, "Senior engineer");
  assert.equal(data.get("capture:a").state, "kept");
  assert.equal($("result").hidden, false);
  assert.equal($("status").textContent, "kept");

  $("delete").click();
  await settle();
  assert.equal(data.has("capture:a"), false);
  assert.deepEqual(data.get("captures"), []);
  assert.deepEqual(removed, [9]);
});
