// Which language folders are complete enough to ship. Weblate may hand over a language
// with only some of its sentences; the browser would then show English for the rest, which
// reads as a bug. The build leaves such a folder out of the package (see build.mjs).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The folders under `dir` whose messages.json lacks a key `en` has, or holds an empty one. */
export function incompleteLocales(dir) {
  const read = (folder) => JSON.parse(readFileSync(join(dir, folder, "messages.json"), "utf8"));
  const keys = Object.keys(read("en"));
  return readdirSync(dir).filter((folder) => {
    if (folder === "en") return false;
    const catalogue = read(folder);
    return keys.some((key) => typeof catalogue[key]?.message !== "string" || !catalogue[key].message.trim());
  });
}
