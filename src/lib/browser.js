// Chromium exposes `chrome`, Firefox exposes `browser` (and `chrome` as an alias). Both
// return promises in Manifest V3, so no polyfill is needed: pick whichever exists.
import { Refusal } from "./api.js";

export const ext = globalThis.browser ?? globalThis.chrome;

/** Where captures go and with what token, and `offline`: the switch, for testing, that has
 *  the extension act as if Postulo could not be reached. `language` is the tag picked for the
 *  extension, empty to follow the browser. */
export async function loadSettings() {
  const stored = await ext.storage.local.get(["instance", "token", "offline", "language"]);
  return {
    instance: stored.instance || "",
    token: stored.token || "",
    offline: stored.offline === true,
    language: stored.language || "",
  };
}

export async function saveSettings({ instance, token }) {
  await ext.storage.local.set({ instance, token });
}

export async function setOffline(offline) {
  await ext.storage.local.set({ offline });
}

/** The language the person picked for the extension, as a tag; empty to follow the browser. */
export async function setLanguage(language) {
  await ext.storage.local.set({ language });
}

/** Whether the instance's origin may be contacted; requests it when asked. */
export async function hasHostPermission(pattern) {
  return ext.permissions.contains({ origins: [pattern] });
}

export async function requestHostPermission(pattern) {
  return ext.permissions.request({ origins: [pattern] });
}

/** The current tab's address and source, read through a content script injected for this
 *  one call. Only activeTab is needed: nothing runs on any page until the person asks. */
export async function readCurrentTab() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Refusal("noTab");
  }
  if (!/^https?:/.test(tab.url || "")) {
    throw new Refusal("notWebPage");
  }
  let injected;
  try {
    [injected] = await ext.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ url: location.href, html: document.documentElement.outerHTML }),
    });
  } catch (error) {
    // The browser refuses some pages (its own store, policy-blocked hosts, error pages)
    // with a developer message in English; say the translated sentence, keep the cause.
    console.warn("Postulo could not script the page:", error && error.message);
    throw new Refusal("unreadable");
  }
  if (!injected || !injected.result) {
    throw new Refusal("unreadable");
  }
  // Which tab it was, for a picture of it later (picture.js).
  return { ...injected.result, tabId: tab.id, windowId: tab.windowId };
}
