// Chromium exposes `chrome`, Firefox exposes `browser` (and `chrome` as an alias). Both
// return promises in Manifest V3, so no polyfill is needed: pick whichever exists.
import { Refusal } from "./api.js";

export const ext = globalThis.browser ?? globalThis.chrome;

export async function loadSettings() {
  const stored = await ext.storage.local.get(["instance", "token"]);
  return { instance: stored.instance || "", token: stored.token || "" };
}

export async function saveSettings({ instance, token }) {
  await ext.storage.local.set({ instance, token });
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
  const [injected] = await ext.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({ url: location.href, html: document.documentElement.outerHTML }),
  });
  if (!injected || !injected.result) {
    throw new Refusal("unreadable");
  }
  return injected.result;
}
