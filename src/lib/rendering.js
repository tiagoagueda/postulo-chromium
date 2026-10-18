// The picture of the whole page that Postulo may keep beside a capture (postulo/postulo#256):
// what the server asks for, how a long page is cut into screens, and how the picture is
// made small enough. Pure, so it is tested without a browser; drawing is in picture.js.

/** The kinds of picture this extension can draw, best first. A PDF is not one of them. */
const DRAWABLE = ["image/webp", "image/jpeg", "image/png"];

/** `url` as an address on the instance's own origin, or "" when it is not one (SEC2-079).
 *  Every address the server supplies for the person to open -- a review page, a listing --
 *  goes through here: a path alone is resolved against the instance, and an address on
 *  another origin leaves no link to it. */
export function onInstance(url, instance) {
  if (typeof url !== "string" || !url) {
    return "";
  }
  try {
    const given = new URL(url, instance);
    return /^https?:$/.test(given.protocol) && given.origin === new URL(instance).origin ? given.toString() : "";
  } catch {
    return "";
  }
}

/** What a capture's answer says about a picture of the page, or null when none is wanted:
 *  the server does not accept one, is older than the question, or asks for something this
 *  cannot give. The address must be on the instance's own origin, because the token goes
 *  with the request and goes nowhere else. */
export function renderingOffer(instance, page) {
  if (!page || page.accepts_rendering !== true || typeof page.rendering_url !== "string") {
    return null;
  }
  const max = page.rendering_max_bytes;
  const types = Array.isArray(page.rendering_types) ? DRAWABLE.filter((type) => page.rendering_types.includes(type)) : [];
  if (!types.length || !Number.isFinite(max) || max <= 0) {
    return null;
  }
  let url;
  try {
    url = new URL(page.rendering_url, instance);
    if (url.origin !== new URL(instance).origin) {
      return null;
    }
  } catch {
    return null;
  }
  return { url: url.toString(), types, max };
}

/** The part of a capture's answer worth keeping until the person decides: no more than the
 *  offer needs, and nothing at all for a capture made with others from a results page. */
export function pageOf(result, batch) {
  const page = result && result.page;
  if (batch || !page || page.accepts_rendering !== true) {
    return null;
  }
  const { accepts_rendering, rendering_url, rendering_types, rendering_max_bytes } = page;
  return { accepts_rendering, rendering_url, rendering_types, rendering_max_bytes };
}

/** Where each screen of a page `total` tall starts, `screen` tall each, the last one placed
 *  so that it ends where the page does. At most `limit` screens: a page longer than that
 *  is drawn as far as it goes. */
export function screenStarts(total, screen, limit) {
  if (!(screen > 0) || !(total > screen)) {
    return [0];
  }
  const starts = [];
  for (let at = 0; at < total && starts.length < limit; at += screen) {
    starts.push(Math.min(at, total - screen));
  }
  return starts;
}

/** The ways to encode a picture, in the order to try them: one lossy type at a stated
 *  quality, then smaller, or PNG scaled down. */
function attempts(type) {
  if (type === "image/png") {
    return [1, 0.75, 0.5, 0.35, 0.25].map((scale) => ({ type, quality: undefined, scale }));
  }
  return [
    [1, 0.85],
    [1, 0.6],
    [0.75, 0.7],
    [0.5, 0.7],
    [0.35, 0.7],
    [0.25, 0.7],
  ].map(([scale, quality]) => ({ type, quality, scale }));
}

/** The first encoding no larger than `max` bytes, or null when none is. `encode` takes
 *  `{type, quality, scale}` and resolves to a Blob; one that comes back as another type
 *  (the browser cannot make the one asked) moves on to the next type. */
export async function smallEnough(types, max, encode) {
  for (const type of types) {
    for (const attempt of attempts(type)) {
      const blob = await encode(attempt);
      if (!blob || blob.type !== type) {
        break;
      }
      if (blob.size <= max) {
        return blob;
      }
    }
  }
  return null;
}
