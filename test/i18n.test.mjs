// Runs with `node --test`: every language says every sentence, with the same placeholders.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SOURCE = "src";
const LOCALES = join(SOURCE, "_locales");

// English, plus every language Postulo itself offers: the core's catalogues at 100%.
// Each is a BCP 47 tag in its canonical form, the way Postulo writes one (#12). The core
// says fr-FR and en-GB where this says fr and en: the region is dropped where the core has
// one variety of a language and kept where it has two (pt-BR, pt-PT), because the tag names
// the catalogue that is served and a browser set to any French matches the fr folder.
const OFFERED = [
  "bg", "bs", "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fi", "fr",
  "ga", "gl", "hr", "hu", "hy", "is", "it", "ka", "lb", "lt", "lv", "mk", "mt", "nb",
  "nl", "pl", "pt-BR", "pt-PT", "ro", "sk", "sl", "sq", "sr-Cyrl", "sv", "tr", "uk",
];

/** The folder the browser looks in for `tag`: the one place a language is not named by its
 *  tag. The WebExtension format names a folder by language and region, with an underscore,
 *  and never by script, so Serbian's is `sr` whichever script its catalogue is written in. */
function folderOf(tag) {
  const { language, region } = new Intl.Locale(tag);
  return region ? `${language}_${region}` : language;
}

const tagOf = Object.fromEntries(OFFERED.map((tag) => [folderOf(tag), tag]));

function read(path) {
  const text = readFileSync(path, "utf8");
  assert.notEqual(text.charCodeAt(0), 0xfeff, `${path} starts with a byte-order mark`);
  return JSON.parse(text);
}

const folders = readdirSync(LOCALES).sort();
const messages = Object.fromEntries(folders.map((folder) => [folder, read(join(LOCALES, folder, "messages.json"))]));
const english = messages.en;

const placeholdersIn = (message) => [...message.matchAll(/\$([A-Za-z_]+)\$/g)].map((match) => match[1].toLowerCase()).sort();

test("the extension speaks the languages Postulo does, English by default", () => {
  assert.deepEqual(folders, OFFERED.map(folderOf).sort());
  assert.equal(read(join(SOURCE, "manifest.json")).default_locale, folderOf("en"));
});

test("a language is named by a BCP 47 tag in its canonical form, and its folder follows from it", () => {
  for (const tag of OFFERED) {
    assert.deepEqual(Intl.getCanonicalLocales(tag), [tag], `${tag} is not how that tag is written`);
  }
  assert.equal(Object.keys(tagOf).length, OFFERED.length, "two languages would share a folder");
});

test("every language has every sentence, and nothing else", () => {
  for (const [folder, catalogue] of Object.entries(messages)) {
    assert.deepEqual(Object.keys(catalogue).sort(), Object.keys(english).sort(), folder);
    for (const [key, entry] of Object.entries(catalogue)) {
      assert.equal(typeof entry.message, "string", `${folder}.${key}`);
      assert.ok(entry.message.trim(), `${folder}.${key} is empty`);
    }
  }
});

test("placeholders are the same in every language, in the order the code passes them", () => {
  for (const [folder, catalogue] of Object.entries(messages)) {
    for (const [key, entry] of Object.entries(catalogue)) {
      assert.deepEqual(placeholdersIn(entry.message), placeholdersIn(english[key].message), `${folder}.${key}`);
      assert.deepEqual(entry.placeholders, english[key].placeholders, `${folder}.${key}`);
    }
  }
});

test("each translation names its own language, so the page's lang attribute is right", () => {
  for (const [folder, catalogue] of Object.entries(messages)) {
    assert.equal(catalogue.languageTag.message, tagOf[folder], folder);
    assert.ok(["ltr", "rtl"].includes(catalogue.direction.message), folder);
  }
});

test("a date is written in the language of the catalogue in use, not the browser's", () => {
  // With no locale named, toLocaleDateString() and Intl's formatters follow the browser's
  // setting. That may be a language nobody has translated: the sentence is then the English
  // one, and the date inside it is in another language.
  const unnamed = /\.toLocale(?:Date|Time)?String\(\s*\)|\bIntl\.\w+\(\s*\)/;
  const scripts = readdirSync(SOURCE, { recursive: true }).filter((name) => name.endsWith(".js"));
  assert.ok(scripts.length, "no script was read");
  for (const name of scripts) {
    assert.doesNotMatch(readFileSync(join(SOURCE, name), "utf8"), unnamed, name);
  }
});

test("the scope keeps its name in every language: it is what Postulo calls it", () => {
  for (const [folder, catalogue] of Object.entries(messages)) {
    assert.match(catalogue.lacksCaptures.message, /\bcaptures\b/, folder);
  }
});

test("every key the code asks for exists, and every sentence is asked for", () => {
  const patterns = [
    /\bt\("([A-Za-z]+)"/g,
    /\bRefusal\("([A-Za-z]+)"/g,
    /\blocaliseWith\([^,]+, "([A-Za-z]+)"/g,
    /\bkey: "([A-Za-z]+)"/g,
    /data-i18n(?:-label)?="([A-Za-z]+)"/g,
    /__MSG_([A-Za-z]+)__/g,
  ];
  const files = readdirSync(SOURCE, { recursive: true })
    .filter((name) => /\.(js|html|json)$/.test(name) && !name.startsWith("_locales"))
    .map((name) => readFileSync(join(SOURCE, name), "utf8"));
  const used = new Set(files.flatMap((text) => patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]))));
  for (const key of used) {
    assert.ok(key in english, `the code asks for ${key}, which en does not have`);
  }
  for (const key of Object.keys(english)) {
    assert.ok(used.has(key), `en has ${key}, which nothing asks for`);
  }
});
