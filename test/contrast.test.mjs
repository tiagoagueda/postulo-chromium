// Runs with `node --test`: the colour pairs in style.css clear WCAG 2.2 AA in both schemes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\/\*[^]*?\*\//g, "");

/** The custom properties of a block, as {name: "#rrggbb"}. */
function tokens(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]));
}

const light = tokens(css.match(/:root\s*\{([^}]*)\}/)[1]);
const dark = { ...light, ...tokens(css.match(/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/)[1]) };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The custom property a rule gives to a declaration, so the test follows the stylesheet. */
function used(selector, property) {
  const rule = css.split("}").find((r) => r.split("{")[0].trim().replace(/\s+/g, " ") === selector);
  return rule.match(new RegExp(`(?<![-\\w])${property}:[^;]*var\\(--([\\w-]+)\\)`))[1];
}

for (const [name, t] of [["light", light], ["dark", dark]]) {
  test(`${name}: button text, tag and field borders reach their ratios`, () => {
    const onBrand = used("button.primary, .button.primary", "color");
    assert.ok(ratio(t[onBrand], t.brand) >= 4.5, "primary button");
    assert.ok(ratio(t[onBrand], t["brand-dark"]) >= 4.5, "primary button on hover");
    assert.ok(ratio(t[used(".tag", "color")], t[used(".tag", "background")]) >= 4.5, "tag");
    assert.ok(ratio(t[used("input, select, textarea", "border")], t.paper) >= 3, "field border");
  });
}

for (const [name, t] of [["light", light], ["dark", dark]]) {
  test(`${name}: the footer's state icons clear 3:1 on the page`, () => {
    for (const token of ["ok", "warn", "error", "muted"]) {
      assert.ok(ratio(t[token], t.paper) >= 3, `--${token}`);
    }
  });
}
