// The mark: a vector where a browser takes one, PNGs rendered from it where it does not
// (postulo/postulo#1238; scripts/icons.py).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const { manifestFor, VECTOR_ICON } = await import("../scripts/build.mjs");

const source = JSON.parse(readFileSync("src/manifest.json", "utf8"));

test("Firefox's build names the vector for every icon size, Chromium's the PNGs", () => {
  const firefox = manifestFor("firefox", source);
  const chromium = manifestFor("chromium", source);
  assert.deepEqual(Object.keys(firefox.icons), Object.keys(source.icons));
  for (const path of Object.values(firefox.icons)) assert.equal(path, VECTOR_ICON);
  for (const path of Object.values(chromium.icons)) assert.match(path, /^icons\/postulo-\d+\.png$/);
  // The toolbar stays a raster in both: its grey state is one.
  for (const built of [firefox, chromium]) {
    for (const path of Object.values(built.action.default_icon)) assert.match(path, /\.png$/);
  }
});

test("the vector is a plain SVG with a square viewBox, as Firefox asks", () => {
  const svg = readFileSync(`src/${VECTOR_ICON}`, "utf8");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  const [, width, height] = /viewBox="([-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+))"/.exec(svg).slice(1);
  assert.equal(width, height);
  assert.doesNotMatch(svg, /<script|foreignObject|href="(?!#)/);
});

test("the extension's own pages show the vector, not a PNG", () => {
  for (const page of ["popup.html", "review.html", "captures.html"]) {
    const html = readFileSync(`src/${page}`, "utf8");
    assert.match(html, /<img src="icons\/postulo\.svg"/, page);
    assert.doesNotMatch(html, /icons\/postulo-\d+\.png/, page);
  }
});

test("every icon the manifest names is there", () => {
  for (const target of ["chromium", "firefox"]) {
    const built = manifestFor(target, source);
    for (const path of [...Object.values(built.icons), ...Object.values(built.action.default_icon)]) {
      assert.ok(existsSync(`src/${path}`), `${target}: ${path}`);
    }
  }
});
