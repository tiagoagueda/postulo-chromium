// Runs with `node --test`: a language that arrives from Weblate half translated is left out of the build.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { incompleteLocales } from "../scripts/locales.mjs";

function catalogues(files) {
  const dir = mkdtempSync(join(tmpdir(), "locales-"));
  for (const [folder, messages] of Object.entries(files)) {
    mkdirSync(join(dir, folder));
    const body = Object.fromEntries(Object.entries(messages).map(([key, message]) => [key, { message }]));
    writeFileSync(join(dir, folder, "messages.json"), JSON.stringify(body));
  }
  return dir;
}

test("a language missing a sentence, or holding an empty one, is incomplete", () => {
  const dir = catalogues({
    en: { a: "A", b: "B" },
    fr: { a: "A", b: "B" },
    de: { a: "A" },
    es: { a: "A", b: "  " },
  });
  assert.deepEqual(incompleteLocales(dir).sort(), ["de", "es"]);
});

test("the source language is never left out", () => {
  assert.deepEqual(incompleteLocales(catalogues({ en: { a: "A" } })), []);
});
