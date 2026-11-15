// Runs with `node --test`: the settings page's Save, with the browser and Postulo stubbed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { JSDOM } from "jsdom";

test("Save does not store a token that holds more than `captures` (SEC3-011)", async () => {
  const dom = new JSDOM(readFileSync(new URL("../src/options.html", import.meta.url), "utf8"), { url: "chrome-extension://x/options.html" });
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
  let scopes = ["captures", "read"];
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.location = dom.window.location;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Option = dom.window.Option;
  globalThis.navigator ??= dom.window.navigator;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ name: "n", owner: "o", scopes }), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.chrome = {
    i18n: { getMessage: (key) => (key === "languageTag" ? "en" : key) },
    storage: { local: area, onChanged: { addListener() {} } },
    runtime: { getManifest: () => ({ version: "0" }), openOptionsPage() {} },
    permissions: { contains: async () => true, request: async () => true, remove: async () => true },
  };
  await import("../src/options.js");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  await settle();
  const $ = (id) => dom.window.document.getElementById(id);
  const save = async () => {
    $("instance").value = "https://postulo.example.org";
    $("token").value = "tok";
    $("settings").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await settle();
  };

  await save();
  assert.equal(data.has("token"), false, "the wide token is not kept");
  assert.equal($("status").textContent, "tokenTooWide");
  assert.equal($("status").classList.contains("error"), true);

  scopes = ["captures"];
  await save();
  assert.equal(data.get("token"), "tok");
});
