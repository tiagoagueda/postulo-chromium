// Runs with `node --test`: the host permission is given back when it is no longer needed (SEC3-012).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { JSDOM } from "jsdom";

test("saving another address gives the old origin back, and a Test of an unsaved address leaves none behind", async () => {
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
  const held = new Set();
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.location = dom.window.location;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Option = dom.window.Option;
  globalThis.navigator ??= dom.window.navigator;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ name: "n", owner: "o", scopes: ["captures"] }), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.chrome = {
    i18n: { getMessage: (key) => (key === "languageTag" ? "en" : key) },
    storage: { local: area, onChanged: { addListener() {} } },
    runtime: { getManifest: () => ({ version: "0" }), openOptionsPage() {} },
    permissions: {
      contains: async ({ origins }) => origins.every((origin) => held.has(origin)),
      request: async ({ origins }) => {
        origins.forEach((origin) => held.add(origin));
        return true;
      },
      remove: async ({ origins }) => {
        origins.forEach((origin) => held.delete(origin));
        return true;
      },
    },
  };
  await import("../src/options.js");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  await settle();
  const $ = (id) => dom.window.document.getElementById(id);
  const fill = (address) => {
    $("instance").value = address;
    $("token").value = "tok";
  };

  fill("https://a.example.org");
  $("settings").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await settle();
  assert.deepEqual([...held], ["https://a.example.org/*"]);

  fill("https://b.example.org");
  $("settings").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await settle();
  assert.deepEqual([...held], ["https://b.example.org/*"], "only the saved address's origin is held");

  fill("https://c.example.org");
  $("test").click();
  await settle();
  assert.deepEqual([...held], ["https://b.example.org/*"], "a tested address that is not saved is not kept");

  fill("https://b.example.org");
  $("test").click();
  await settle();
  assert.deepEqual([...held], ["https://b.example.org/*"], "testing the saved address leaves it held");
});
