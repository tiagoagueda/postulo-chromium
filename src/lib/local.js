// The captures kept in this browser, the log, and delivery, as every page of the extension
// and its background use them: one store and one log over storage.local.

import { originPattern } from "./api.js";
import { ext, hasHostPermission, loadSettings } from "./browser.js";
import { explain, t, useStoredLanguage } from "./i18n.js";
import { makeLog } from "./log.js";
import { deliver } from "./outbox.js";
import { makeStore } from "./store.js";

export const store = makeStore(ext.storage.local);
export const log = makeLog(ext.storage.local);

/** Send what is waiting (or only the captures in `only`), and remember how it went. */
export async function deliverWaiting(only = null) {
  // The background wakes with no language loaded, and what it asks Postulo for is worded by it.
  await useStoredLanguage();
  const settings = await loadSettings();
  const result = await deliver({
    store,
    log,
    settings,
    only,
    allowed: () => hasHostPermission(originPattern(settings.instance)),
  });
  if (result.outcome !== "nothing") {
    await ext.storage.local.set({ lastDelivery: { at: new Date().toISOString(), ...result } });
  }
  return result;
}

/** The number on the toolbar button: captures that have not reached Postulo yet. */
export async function showUnsentCount() {
  const count = await store.unsentCount();
  await ext.action.setBadgeText({ text: count ? String(count) : "" });
  await ext.action.setBadgeBackgroundColor({ color: "#2563eb" });
}

/** The sentences the browser keeps for the extension, in the language it speaks: the tooltip
 *  of the button, and where the browser lets it be changed, the shortcut's description.
 *  Browsers forget a tooltip set from here when they restart, so this runs at start-up too. */
export async function showLanguage() {
  await useStoredLanguage();
  try {
    await ext.action.setTitle({ title: t("actionTitle") });
    // Only Firefox on a computer can re-word a shortcut; elsewhere there is no such call.
    await ext.commands?.update?.({ name: "_execute_action", description: t("actionTitle") });
  } catch (error) {
    await log.add("language not shown", { problem: error && error.message });
  }
}

/** What became of captures that were to be sent and are still here, in words, and whether
 *  that is a problem for the person to fix. */
export function afterSending(result) {
  switch (result.outcome) {
    case "unconfigured":
      return [t("sendNeedsSetup"), false];
    case "offline":
      return [t("waitingOffline"), false];
    case "noPermission":
      return [t("noPermission"), true];
    case "account":
      return [`${explain(result.problem)} ${t("waitingAccount")}`, true];
    default:
      return [t("waiting"), false];
  }
}

/** Open the list of captures kept in this browser, in a tab. */
export function openCaptures() {
  return ext.tabs.create({ url: ext.runtime.getURL("captures.html") });
}
