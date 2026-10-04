// The captures kept in this browser, the log, and delivery, as every page of the extension
// and its background use them: one store and one log over storage.local.

import { originPattern } from "./api.js";
import { ext, hasHostPermission, loadSettings } from "./browser.js";
import { explain, t, useStoredLanguage } from "./i18n.js";
import { makeLog } from "./log.js";
import { deliver } from "./outbox.js";
import { makeStore } from "./store.js";
import { badgeText, countPostings, lastWaiting, refreshWaiting, WAITING } from "./waiting.js";

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
  // What was sent is waiting in Postulo now, so its list is read again at once and the
  // number does not dip in between.
  if (result.sent) {
    await readWaitingList();
  }
  return result;
}

let reading = null;

/** Read the captures waiting in Postulo, and show the number. Asks nothing of a Postulo
 *  that is not to be asked (see `refreshWaiting`); one read at a time in each page. */
export function readWaitingList({ maxAgeMs = 0 } = {}) {
  if (reading) {
    // A read already under way began before whatever asks now (a delivery, a changed token),
    // so it may not hold what that changed; a caller that wants it fresh reads once more after.
    return maxAgeMs ? reading : reading.then(() => readWaitingList(), () => readWaitingList());
  }
  reading = (async () => {
    try {
      const settings = await loadSettings();
      await refreshWaiting({
        area: ext.storage.local,
        settings,
        allowed: () => hasHostPermission(originPattern(settings.instance)),
        maxAgeMs,
      });
    } finally {
      reading = null;
    }
    await showUnsentCount();
  })();
  return reading;
}

/** Forget the list read from the Postulo that was set up before, and read the new one. */
export async function forgetWaitingList() {
  await ext.storage.local.remove(WAITING);
  await showUnsentCount();
  await readWaitingList();
}

/** The number on the toolbar button: the postings waiting for review, in Postulo as last
 *  read and in this browser not yet sent, one for each address. */
export async function showUnsentCount() {
  const settings = await loadSettings();
  const count = countPostings(await lastWaiting(ext.storage.local, settings), await store.list());
  await ext.action.setBadgeText({ text: badgeText(count) });
  await ext.action.setBadgeBackgroundColor({ color: "#2563eb" });
  // Where the browser has it, the number in white on the blue: the default is picked for
  // the page behind a badge and not always readable on this one.
  if (ext.action.setBadgeTextColor) {
    await ext.action.setBadgeTextColor({ color: "#ffffff" });
  }
  await ext.action.setTitle({ title: count ? t("waitingForReview", [String(count)]) : t("actionTitle") });
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
