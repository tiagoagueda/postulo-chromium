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

/** The mark as a vector, which Firefox takes for the extension's icons (MDN, manifest.json
 *  `icons`: "You can use SVG, and the browser scales your icon appropriately", given a
 *  viewBox and the sizes still listed). Chromium does not (crbug.com/29683), so the source
 *  manifest names the PNGs rendered from it (postulo/postulo#1238). The toolbar button
 *  stays PNG in both: its grey "offline" state is a raster set at run time, and the button in
 *  colour is the same picture as that grey one. */
export const VECTOR_ICON = "icons/postulo.svg";

export function manifestFor(target, source = manifest) {
  const copy = structuredClone(source);
  if (target === "chromium") {
    delete copy.background.scripts;
    delete copy.browser_specific_settings;
  } else if (target === "firefox") {
    delete copy.background.service_worker;
    copy.icons = Object.fromEntries(Object.keys(copy.icons).map((size) => [size, VECTOR_ICON]));
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
  const built = manifestFor(target);
  writeFileSync(join(out, "manifest.json"), JSON.stringify(built, null, 2) + "\n");
  // A rendered icon the build's manifest no longer names (Firefox's take the vector) is not
  // shipped; the toolbar's, coloured and grey, always are.
  const named = new Set([...Object.values(built.icons), ...Object.values(built.action.default_icon)]);
  for (const path of Object.values(manifest.icons)) if (!named.has(path)) rmSync(join(out, path));
  console.log(`${target}: ${out}`);
}
