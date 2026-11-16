// Runs with `node --test`: filling a form from the person's details (#51).
import assert from "node:assert/strict";
import { test } from "node:test";

import { JSDOM } from "jsdom";

import { fillPage, KINDS, valuesFrom } from "../src/lib/fill.js";
import { forgetPostulo, saveConnection } from "../src/lib/settings.js";

const PROFILE = { first_name: "Ana", last_name: "Silva", birth_date: "1990-03", form_of_address: { key: "mrs", label: "Mme" } };
const ME = { owner: "ana@example.org" };

/** Run the page's side on `html`, as the browser would inject it. */
function fill(html, values) {
  const dom = new JSDOM(`<body>${html}</body>`);
  const saved = {};
  for (const name of ["document", "HTMLInputElement", "HTMLTextAreaElement", "Event"]) {
    saved[name] = globalThis[name];
    globalThis[name] = dom.window[name];
  }
  try {
    return { result: fillPage(values, KINDS), document: dom.window.document, dom };
  } finally {
    Object.assign(globalThis, saved);
  }
}

test("the details come from the profile and the account, and a blank is left out", () => {
  assert.deepEqual(valuesFrom(PROFILE, ME), { given: "Ana", family: "Silva", name: "Ana Silva", email: "ana@example.org", prefix: "Mme" });
  assert.equal(valuesFrom({ ...PROFILE, birth_date: "1990-03-12" }, ME).birthday, "1990-03-12");
  assert.deepEqual(valuesFrom({ first_name: "Ana", last_name: "" }, { owner: "" }), { given: "Ana", name: "Ana" });
});

test("fields are recognised by autocomplete first, then by their label, and marked", () => {
  const values = valuesFrom(PROFILE, ME);
  const { result, document } = fill(
    `<form>
       <input id="a" autocomplete="given-name">
       <label for="b">Last name *</label><input id="b">
       <label>E-mail <input id="c"></label>
       <input id="d" type="text" placeholder="Prénom">
       <input id="e" autocomplete="shipping family-name">
       <input id="f" autocomplete="street-address" aria-label="Email of the street">
     </form>`,
    values,
  );
  const value = (id) => document.getElementById(id).value;
  assert.deepEqual(["a", "b", "c", "d", "e", "f"].map(value), ["Ana", "Silva", "ana@example.org", "Ana", "Silva", ""]);
  assert.equal(document.getElementById("a").getAttribute("data-postulo-filled"), "given");
  assert.match(document.getElementById("a").style.outline, /solid/);
  assert.equal(result.filled.length, 5);
  assert.equal(result.left.length, 1);
});

test("a password, a file, what is typed, a list, a disabled field and a hidden one are left alone", () => {
  const { result, document } = fill(
    `<input id="p" type="password" autocomplete="given-name">
     <input id="f" type="file" name="email">
     <input id="t" autocomplete="given-name" value="Maria">
     <select id="s" autocomplete="given-name"><option>x</option></select>
     <input id="d" autocomplete="given-name" disabled>
     <input id="h" type="hidden" autocomplete="given-name">
     <div hidden><input id="g" autocomplete="given-name"></div>
     <input id="c" type="checkbox" autocomplete="given-name">`,
    valuesFrom(PROFILE, ME),
  );
  for (const id of ["p", "f", "d", "h", "g", "c"]) {
    assert.equal(document.getElementById(id).value === "" || id === "c" || id === "f", true, id);
    assert.equal(document.getElementById(id).hasAttribute("data-postulo-filled"), false, id);
  }
  assert.equal(document.getElementById("t").value, "Maria");
  assert.deepEqual(result.filled, []);
});

test("it never submits: no event but input and change, no click, the form untouched", () => {
  const dom = new JSDOM(`<body><form id="f"><input autocomplete="email"><button type="submit">Apply</button></form></body>`);
  const seen = [];
  for (const type of ["submit", "click", "input", "change"]) {
    dom.window.document.addEventListener(type, () => seen.push(type), true);
  }
  const saved = {};
  for (const name of ["document", "HTMLInputElement", "HTMLTextAreaElement", "Event"]) {
    saved[name] = globalThis[name];
    globalThis[name] = dom.window[name];
  }
  try {
    fillPage(valuesFrom(PROFILE, ME), KINDS);
  } finally {
    Object.assign(globalThis, saved);
  }
  assert.deepEqual(seen, ["input", "change"]);
});

test("a field that matches nothing is listed, by the label the page gives it", () => {
  const { result } = fill(`<label for="x">Why do you want this job?</label><textarea id="x"></textarea>`, valuesFrom(PROFILE, ME));
  assert.deepEqual(result.left, ["Why do you want this job?"]);
});

function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(keys) {
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => data.has(key)).map((key) => [key, data.get(key)]));
    },
    async set(items) {
      Object.entries(items).forEach(([key, value]) => data.set(key, value));
    },
    async remove(keys) {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => data.delete(key));
    },
  };
}
const nobody = { async list() { return []; }, async update() {} };

test("the token for filling forms goes with its Postulo: dropped on another address, and on forgetting", async () => {
  const area = memory({ instance: "https://a.example", token: "t", fillToken: "f" });
  await saveConnection({ area, store: nobody, next: { instance: "https://a.example", token: "t2" } });
  assert.equal(area.data.get("fillToken"), "f");
  await saveConnection({ area, store: nobody, next: { instance: "https://b.example", token: "t3" } });
  assert.equal(area.data.has("fillToken"), false);
  await saveConnection({ area, store: nobody, next: { instance: "https://b.example", token: "t3", fillToken: "g" } });
  assert.equal(area.data.get("fillToken"), "g");
  await saveConnection({ area, store: nobody, next: { instance: "https://b.example", token: "t3", fillToken: "" } });
  assert.equal(area.data.has("fillToken"), false);
  await area.set({ fillToken: "h" });
  await forgetPostulo({ area, store: nobody });
  assert.equal(area.data.has("fillToken"), false);
});
