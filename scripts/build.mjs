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

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = "src";
const DIST = "dist";
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ["chromium", "firefox"];

const manifest = JSON.parse(readFileSync(join(SOURCE, "manifest.json"), "utf8"));

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

for (const target of targets) {
  const out = join(DIST, target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(SOURCE, out, { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifestFor(target), null, 2) + "\n");
  console.log(`${target}: ${out}`);
}
