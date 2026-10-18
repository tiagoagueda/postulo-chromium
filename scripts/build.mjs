// Assemble the extension for each browser from the one source in src/.
//
// The two builds differ in the manifest only. Chromium's Manifest V3 wants a service
// worker background and warns about keys it does not know; Firefox wants an event page
// (`background.scripts`) and a gecko id. The source manifest carries everything; this
// strips what each target would complain about, copies the rest, and leaves a directory
// per browser under dist/ ready to load unpacked or to zip.
//
//   node scripts/build.mjs            # dist/chromium and dist/firefox
//   node scripts/build.mjs firefox    # one of them

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES } from "../src/lib/languages.js";
import { incompleteLocales } from "./locales.mjs";

const SOURCE = "src";
const DIST = "dist";
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ["chromium", "firefox"];

const incomplete = incompleteLocales(join(SOURCE, "_locales"));
for (const folder of incomplete) console.warn(`Leaving out ${folder}: its catalogue is not complete.`);

const manifest = JSON.parse(readFileSync(join(SOURCE, "manifest.json"), "utf8"));

/** A catalogue as it ships: the translation, and what the code asks of it about itself.
 *
 *  `languageTag` and `direction` are not sentences: they are the catalogue's language and
 *  its direction, which the page's `lang` and `dir` and every date read. They used to sit in
 *  each messages.json beside the sentences, where a translator, or machine translation,
 *  could "translate" `ltr`. Translations are made in Weblate now (postulo/postulo#706), so
 *  they come from src/lib/languages.js and are written here, into what ships. */
export function shipped(catalogue, language) {
  // The build's values last, so a catalogue that carries either key cannot override them.
  return {
    ...catalogue,
    languageTag: { message: language.tag, description: "This catalogue's language: set by the build." },
    direction: { message: language.direction, description: "ltr or rtl: set by the build." },
  };
}

function manifestFor(target) {
  const copy = structuredClone(manifest);
  if (target === "chromium") {
    delete copy.background.scripts;
    delete copy.browser_specific_settings;
  } else if (target === "firefox") {
    delete copy.background.service_worker;
  } else {
    throw new Error(`Unknown target ${target}; chromium or firefox.`);
  }
  return copy;
}

if (process.argv[1]?.endsWith("build.mjs")) for (const target of targets) {
  const out = join(DIST, target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(SOURCE, out, { recursive: true });
  for (const folder of incomplete) rmSync(join(out, "_locales", folder), { recursive: true, force: true });
  for (const language of LANGUAGES) {
    const file = join(out, "_locales", language.folder, "messages.json");
    if (!existsSync(file)) continue;
    const catalogue = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify(shipped(catalogue, language), null, 2) + "\n");
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifestFor(target), null, 2) + "\n");
  console.log(`${target}: ${out}`);
}
