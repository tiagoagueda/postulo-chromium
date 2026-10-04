// Runs with `node --test`: the list of captures kept in this browser, redrawn as storage changes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { JSDOM } from "jsdom";

test("deleting a capture leaves focus on a control of the next one", async () => {
  const dom = new JSDOM(readFileSync(new URL("../src/captures.html", import.meta.url), "utf8"), { url: "https://example.test/" });
  const data = new Map();
  const listeners = [];
  const change = (keys) => listeners.forEach((listener) => listener(Object.fromEntries(keys.map((key) => [key, {}])), "local"));
  const area = {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => data.has(key)).map((key) => [key, structuredClone(data.get(key))]));
    },
    async set(items) {
      Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value)));
      change(Object.keys(items));
    },
    async remove(keys) {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => data.delete(key));
      change(Array.isArray(keys) ? keys : [keys]);
    },
  };
  const ids = ["a", "b", "c"];
  data.set("captures", ids);
  for (const id of ids) {
    data.set(`capture:${id}`, { id, url: `https://example.test/${id}`, data: { title: id }, state: "kept", capturedAt: "2026-01-01T00:00:00Z" });
  }
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.chrome = {
    i18n: { getMessage: (key) => (key === "languageTag" ? "en" : key) },
    storage: { local: area, onChanged: { addListener: (listener) => listeners.push(listener) } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    runtime: { openOptionsPage() {} },
    permissions: { contains: async () => true, request: async () => true },
  };
  dom.window.confirm = () => true;
  await import("../src/captures.js");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  await settle();

  const list = dom.window.document.getElementById("list");
  assert.equal(list.children.length, 3);
  [...list.children[1].querySelectorAll("button")].find((b) => b.textContent === "delete").focus();
  [...list.children[1].querySelectorAll("button")].find((b) => b.textContent === "delete").click();
  await settle();

  assert.equal(list.children.length, 2);
  const active = dom.window.document.activeElement;
  assert.notEqual(active, dom.window.document.body);
  assert.equal(active.closest("li"), list.children[1]);
  assert.match(active.closest("li").textContent, /^cstate/);
});
