// Runs with `node --test`: after Send, the review window offers the picture of the page
// when Postulo keeps one and the page was read just now (the popup passes its tab); never
// when the window was opened on a capture found again later, without that tab.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { JSDOM } from "jsdom";

async function reviewAfterSend({ search, accepts }) {
  const dom = new JSDOM(readFileSync(new URL("../src/review.html", import.meta.url), "utf8"), { url: `chrome-extension://x/review.html${search}` });
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
  data.set("instance", "https://postulo.example");
  data.set("token", "t");
  data.set("captures", ["a"]);
  data.set("capture:a", { id: "a", url: "https://example.test/a", source: "schema.org", read: posting, data: posting, state: "kept", capturedAt: "2026-01-01T00:00:00Z" });
  data.set("page:a", "<html></html>");
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.location = dom.window.location;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Option = dom.window.Option;
  const page = accepts ? { accepts_rendering: true, rendering_url: "/api/v1/captures/a/rendering", rendering_types: ["image/png"], rendering_max_bytes: 1000 } : { accepts_rendering: false };
  globalThis.fetch = async () => ({ ok: true, status: 201, json: async () => ({ id: 1, review_url: "https://postulo.example/review/a", page }) });
  globalThis.chrome = {
    i18n: { getMessage: (key) => (key === "languageTag" ? "en" : key) },
    storage: { local: area, onChanged: { addListener() {} } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}, setIcon: async () => {} },
    runtime: { openOptionsPage() {} },
    permissions: { contains: async () => true, request: async () => true },
  };
  await import(`../src/review.js?${Math.random()}`);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  await settle();
  dom.window.document.getElementById("send").click();
  await settle();
  return dom.window.document;
}

test("the picture is offered after Send when Postulo keeps one and the page is still at hand", async () => {
  const doc = await reviewAfterSend({ search: "?id=a&tab=4&window=2", accepts: true });
  assert.equal(doc.getElementById("result").hidden, false);
  assert.equal(doc.getElementById("review").hidden, false);
  assert.equal(doc.getElementById("picture").hidden, false);
  doc.getElementById("picture-skip").click();
  assert.equal(doc.getElementById("picture").hidden, true);
});

test("no picture is offered when Postulo keeps none, or the capture was not read just now", async () => {
  const none = await reviewAfterSend({ search: "?id=a&tab=4&window=2", accepts: false });
  assert.equal(none.getElementById("review").hidden, false);
  assert.equal(none.getElementById("picture").hidden, true);
  const later = await reviewAfterSend({ search: "?id=a", accepts: true });
  assert.equal(later.getElementById("review").hidden, false);
  assert.equal(later.getElementById("picture").hidden, true);
});
