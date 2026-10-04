// Runs with `node --test`: the display language the person can pick, apart from the browser's.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const LOCALES = join("src", "_locales");

// What the browser gives when no language is chosen: a stub that is plainly not any catalogue.
globalThis.chrome = {
  i18n: { getMessage: (key) => (key === "languageTag" ? "xx" : `browser:${key}`) },
  runtime: { getURL: (path) => join("src", path) },
};
const { resolveMessage } = await import("../src/lib/messages.js");
const { LANGUAGES } = await import("../src/lib/languages.js");
const { languageTag, t, useLanguage } = await import("../src/lib/i18n.js");
const { whoAmI } = await import("../src/lib/api.js");

const readCatalogue = (folder) => JSON.parse(readFileSync(join(LOCALES, folder, "messages.json"), "utf8"));
const fromDisk = async (path) => ({ json: async () => JSON.parse(readFileSync(path, "utf8")) });

test("a message is put together as the browser would: named placeholders, then $1 to $9, then $$", () => {
  const catalogue = {
    plain: { message: "Plain" },
    named: { message: "Saved to $HOST$ by $who$.", placeholders: { host: { content: "$1" }, WHO: { content: "$2" } } },
    direct: { message: "Costs $$5, not $1" },
    wrapped: { message: "<$TAG$>", placeholders: { tag: { content: "b$1" } } },
  };
  assert.equal(resolveMessage(catalogue, "plain"), "Plain");
  assert.equal(resolveMessage(catalogue, "named", ["example.org", "you"]), "Saved to example.org by you.");
  assert.equal(resolveMessage(catalogue, "named", ["example.org"]), "Saved to example.org by .");
  assert.equal(resolveMessage(catalogue, "direct", "six"), "Costs $5, not six");
  assert.equal(resolveMessage(catalogue, "wrapped", ["r"]), "<br>");
  // What a substitution brings is never read as a token itself.
  assert.equal(resolveMessage(catalogue, "direct", ["$1 and $$"]), "Costs $5, not $1 and $$");
  assert.equal(resolveMessage(catalogue, "absent"), "");
});

test("every sentence of every catalogue resolves with nothing left over", () => {
  for (const { folder } of LANGUAGES) {
    const catalogue = readCatalogue(folder);
    for (const [key, entry] of Object.entries(catalogue)) {
      const text = resolveMessage(catalogue, key, ["A", "B", "C"]);
      assert.ok(text, `${folder}.${key} resolves to nothing`);
      assert.doesNotMatch(text, /\$[A-Za-z]+\$|\$[1-9]/, `${folder}.${key} keeps a placeholder: ${text}`);
      for (const placeholder of Object.values(entry.placeholders || {})) {
        assert.match(placeholder.content, /^\$[1-9]$/, `${folder}.${key}`);
      }
    }
  }
});

test("the languages offered are the shipped catalogues, each named in itself", () => {
  assert.deepEqual(LANGUAGES.map((language) => language.folder).sort(), readdirSync(LOCALES).sort());
  for (const language of LANGUAGES) {
    const catalogue = readCatalogue(language.folder);
    assert.equal(catalogue.languageTag.message, language.tag, language.folder);
    assert.ok(language.name.trim(), language.folder);
  }
  assert.equal(new Set(LANGUAGES.map((language) => language.tag)).size, LANGUAGES.length);
});

test("with a language chosen, sentences, tag and Postulo's header follow it; without, the browser", async () => {
  assert.equal(t("save"), "browser:save");
  assert.equal(languageTag(), "xx");

  await useLanguage("de", fromDisk);
  assert.equal(t("save"), readCatalogue("de").save.message);
  assert.equal(t("saved", ["example.org"]), resolveMessage(readCatalogue("de"), "saved", ["example.org"]));
  assert.equal(languageTag(), "de");
  let sent = null;
  await whoAmI("https://p.example", "tok", async (url, init) => {
    sent = init.headers;
    return { ok: true, json: async () => ({}) };
  });
  assert.equal(sent["Accept-Language"], "de");

  await useLanguage("pt-PT", fromDisk);
  assert.equal(t("save"), readCatalogue("pt_PT").save.message);

  // Back to the browser's own, and a language that is no longer shipped is passed over.
  await useLanguage("", fromDisk);
  assert.equal(t("save"), "browser:save");
  await useLanguage("tlh", fromDisk);
  assert.equal(t("save"), "browser:save");
});

test("a catalogue that cannot be read leaves the browser's language in place", async () => {
  await useLanguage("fr", async () => {
    throw new Error("not found");
  });
  assert.equal(t("save"), "browser:save");
  assert.equal(languageTag(), "xx");
});
