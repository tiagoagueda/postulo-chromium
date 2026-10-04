// Runs with `node --test`: the picture of the whole page, without a browser.
import assert from "node:assert/strict";
import { test } from "node:test";

import { pictureRefused, sendRendering } from "../src/lib/api.js";
import { pageOf, renderingOffer, screenStarts, smallEnough } from "../src/lib/rendering.js";

const INSTANCE = "https://postulo.example.org";
const page = {
  source: true,
  accepts_rendering: true,
  rendering_url: "https://postulo.example.org/api/v1/captures/7/rendering",
  rendering_types: ["image/png", "image/jpeg", "application/pdf"],
  rendering_max_bytes: 10_000_000,
};

test("a picture is offered only when the server accepts one, on the instance's own address", () => {
  const offer = renderingOffer(INSTANCE, page);
  assert.equal(offer.url, page.rendering_url);
  assert.deepEqual(offer.types, ["image/jpeg", "image/png"], "best first, and no PDF: it cannot be drawn");
  assert.equal(offer.max, 10_000_000);
  assert.equal(renderingOffer(INSTANCE, undefined), null, "an older server sends no page");
  assert.equal(renderingOffer(INSTANCE, { ...page, accepts_rendering: false }), null);
  assert.equal(renderingOffer(INSTANCE, { ...page, rendering_types: ["application/pdf"] }), null);
  assert.equal(renderingOffer(INSTANCE, { ...page, rendering_max_bytes: 0 }), null);
  // The token goes with the request: never to another origin.
  assert.equal(renderingOffer(INSTANCE, { ...page, rendering_url: "https://evil.example/x" }), null);
  assert.equal(renderingOffer(INSTANCE, { ...page, rendering_url: "/api/v1/captures/7/rendering" }).url, page.rendering_url);
});

test("what is kept of a capture's answer is only the offer, and nothing for a batch", () => {
  assert.deepEqual(Object.keys(pageOf({ page }, undefined)).sort(), [
    "accepts_rendering",
    "rendering_max_bytes",
    "rendering_types",
    "rendering_url",
  ]);
  assert.equal(pageOf({ page }, { id: "b", size: 3, position: 1 }), null);
  assert.equal(pageOf({}, undefined), null);
  assert.equal(pageOf({ page: { ...page, accepts_rendering: false } }, undefined), null);
});

test("a long page is cut into screens, the last ending where the page does", () => {
  assert.deepEqual(screenStarts(500, 800, 25), [0]);
  assert.deepEqual(screenStarts(2000, 800, 25), [0, 800, 1200]);
  assert.deepEqual(screenStarts(1600, 800, 25), [0, 800]);
  assert.equal(screenStarts(100000, 800, 25).length, 25, "no more than the limit");
});

const blobOf = (type, size) => ({ type, size });

test("the picture is made smaller until it fits, and never sent larger than the limit", async () => {
  const tried = [];
  const found = await smallEnough(["image/webp"], 1000, async ({ type, quality, scale }) => {
    tried.push([quality, scale]);
    return blobOf(type, 4000 * scale * quality);
  });
  assert.ok(found.size <= 1000);
  assert.deepEqual(tried[0], [0.85, 1]);
  assert.equal(await smallEnough(["image/png"], 10, async ({ type }) => blobOf(type, 5000)), null);
});

test("a type the browser cannot make is skipped for the next one", async () => {
  const found = await smallEnough(["image/webp", "image/jpeg"], 1000, async ({ type }) =>
    type === "image/webp" ? blobOf("image/png", 10) : blobOf(type, 10),
  );
  assert.equal(found.type, "image/jpeg");
});

function fakeFetch(status, body = null) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status, ok: status < 300, json: async () => body };
  };
  return { calls, fetchImpl };
}

test("the picture goes as raw bytes with its own type and the token, not as JSON", async () => {
  const { calls, fetchImpl } = fakeFetch(201);
  const blob = new Blob(["abc"], { type: "image/jpeg" });
  assert.deepEqual(await sendRendering("tok", page.rendering_url, blob, fetchImpl), { kept: true });
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.body, blob);
  assert.equal(calls[0].init.headers["Content-Type"], "image/jpeg");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
});

test("the same bytes sent again are a success; a refusal is final for 409, 413, 415 and 422", async () => {
  const blob = new Blob(["abc"], { type: "image/png" });
  assert.deepEqual(await sendRendering("tok", "u", blob, fakeFetch(200).fetchImpl), { kept: false });
  for (const status of [409, 413, 415, 422]) {
    await assert.rejects(sendRendering("tok", "u", blob, fakeFetch(status, { title: "no" }).fetchImpl), (error) => {
      assert.ok(pictureRefused(error));
      return true;
    });
  }
  await assert.rejects(sendRendering("tok", "u", blob, fakeFetch(429, {}).fetchImpl), (error) => !pictureRefused(error));
});
