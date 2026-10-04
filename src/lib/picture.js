// Drawing the whole page as the person sees it, in the popup, from the tab it was read from.
//
// Firefox can draw any rectangle of a page (tabs.captureTab with a rect in page
// coordinates). Chromium can draw only the screen (tabs.captureVisibleTab), so a long page
// is scrolled and the screens put together. Both need only `activeTab`, which the click on
// the toolbar button granted; neither needs the `debugger` permission and its warning bar.

import { Refusal } from "./api.js";
import { ext } from "./browser.js";
import { screenStarts, smallEnough } from "./rendering.js";

/** The tallest picture, in pixels: canvases of either browser stop somewhere above this. */
const MAX_PIXELS = 16000;
/** The most screens put together on Chromium, which allows two captures a second. */
const MAX_SCREENS = 25;
const BETWEEN_CAPTURES_MS = 600;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run `func` in the tab and resolve to what it returns. */
async function inTab(tabId, func, args = []) {
  const [injected] = await ext.scripting.executeScript({ target: { tabId }, func, args });
  return injected && injected.result;
}

function measure() {
  const root = document.documentElement;
  return {
    url: location.href,
    height: Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0),
    width: root.clientWidth,
    screen: window.innerHeight,
    ratio: window.devicePixelRatio || 1,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

function scrollTo(y) {
  window.scrollTo({ left: window.scrollX, top: y, behavior: "instant" });
  return window.scrollY;
}

/** What stays in place while scrolling would be drawn in every screen: hide it after the
 *  first, and put it back at the end. */
function hideFixed() {
  const hidden = (globalThis.__postuloHidden = globalThis.__postuloHidden || []);
  for (const element of document.querySelectorAll("body *")) {
    const position = getComputedStyle(element).position;
    if (position === "fixed" || position === "sticky") {
      hidden.push([element, element.style.getPropertyValue("visibility"), element.style.getPropertyPriority("visibility")]);
      element.style.setProperty("visibility", "hidden", "important");
    }
  }
}

function showFixed(x, y) {
  for (const [element, value, priority] of globalThis.__postuloHidden || []) {
    element.style.setProperty("visibility", value, priority);
  }
  globalThis.__postuloHidden = [];
  window.scrollTo({ left: x, top: y, behavior: "instant" });
}

async function load(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return image;
}

/** The whole page of the tab (`tabId`, in `windowId`) on a canvas, as it is on the screen
 *  now. `url` is the address it was read from: a tab that has gone elsewhere is not drawn. */
export async function drawPage({ tabId, windowId, url }) {
  const page = await inTab(tabId, measure);
  if (!page || page.url !== url) {
    throw new Refusal("pictureFailed");
  }
  const tallest = Math.floor(MAX_PIXELS / page.ratio);
  const height = Math.min(page.height, tallest);
  if (typeof ext.tabs.captureTab === "function") {
    const dataUrl = await ext.tabs.captureTab(tabId, {
      format: "png",
      rect: { x: 0, y: 0, width: page.width, height },
    });
    return canvasOf([[await load(dataUrl), 0]]);
  }

  // Chromium draws the window's active tab, whichever it is: the page is drawn from another
  // window than the one it is in, so a tab switched meanwhile would be drawn in its place.
  const tab = await ext.tabs.get(tabId);
  if (!tab || !tab.active || tab.windowId !== windowId) {
    throw new Refusal("pictureFailed");
  }
  const shots = [];
  try {
    for (const [index, start] of screenStarts(height, page.screen, MAX_SCREENS).entries()) {
      const at = await inTab(tabId, scrollTo, [start]);
      await wait(BETWEEN_CAPTURES_MS);
      shots.push([await load(await ext.tabs.captureVisibleTab(windowId, { format: "png" })), at * page.ratio]);
      if (index === 0) {
        await inTab(tabId, hideFixed);
      }
    }
  } finally {
    await inTab(tabId, showFixed, [page.scrollX, page.scrollY]).catch(() => {});
  }
  return canvasOf(shots, Math.round(height * page.ratio));
}

/** Screens laid on one canvas, each at its own vertical offset in pixels; `height` cuts it
 *  where the page ends, when the last screen reaches further. */
function canvasOf(shots, height = 0) {
  const canvas = document.createElement("canvas");
  const last = shots[shots.length - 1];
  canvas.width = shots[0][0].width;
  canvas.height = height || Math.round(last[1] + last[0].height);
  const context = canvas.getContext("2d");
  for (const [image, top] of shots) {
    context.drawImage(image, 0, Math.round(top));
  }
  return canvas;
}

/** The canvas as a Blob of one of `types`, no larger than `max` bytes; null when it cannot be. */
export function encodePicture(canvas, types, max) {
  return smallEnough(types, max, ({ type, quality, scale }) => {
    let source = canvas;
    if (scale < 1) {
      source = document.createElement("canvas");
      source.width = Math.max(1, Math.round(canvas.width * scale));
      source.height = Math.max(1, Math.round(canvas.height * scale));
      source.getContext("2d").drawImage(canvas, 0, 0, source.width, source.height);
    }
    return new Promise((resolve) => source.toBlob(resolve, type, quality));
  });
}
