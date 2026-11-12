// The background: opening the settings on first install, and sending what is waiting.
//
// It never reads a page and never decides to send anything. A capture reaches here only
// once somebody has pressed Send; what the background adds is trying again when Postulo
// could not be reached then: every few minutes, and when the browser starts. On the same
// beat it reads the list of captures waiting for review in Postulo, for the number on the
// toolbar button.

import { ext } from "./lib/browser.js";
import { checkPostulo, deliverWaiting, forgetConnection, forgetWaitingList, readWaitingList, showLanguage, showUnsentCount, tidySent } from "./lib/local.js";
import { deliverAndRead as beat } from "./lib/connection.js";
import { afterDelivery } from "./lib/outbox.js";
import { isCaptureKey } from "./lib/store.js";
import { coalesce } from "./lib/waiting.js";

const ALARM = "deliver";
const EVERY_MINUTES = 5;

/** Send what is waiting, then read Postulo's list unless sending already did or Postulo
 *  was just found not to answer (see `deliverAndRead` in connection.js). */
function deliverAndRead() {
  return beat({ deliver: () => deliverWaiting(), check: checkPostulo, read: readWaitingList });
}

/** The number and the icon, recounted once for any number of storage changes, and not
 *  while a delivery is writing its captures one by one: once at its end (#53). */
const recount = coalesce(showUnsentCount, afterDelivery);

function schedule() {
  // Creating an alarm that exists replaces it, so this is safe to repeat.
  ext.alarms.create(ALARM, { periodInMinutes: EVERY_MINUTES });
}

// Browsers forget what was done to the toolbar button when they restart, so the icon is
// set again, as the badge is, whenever the browser starts or the extension is installed or
// updated. The record that `lastDelivery` was is replaced by the connection state.
ext.runtime.onInstalled.addListener((details) => {
  schedule();
  showUnsentCount();
  showLanguage();
  ext.storage.local.remove("lastDelivery");
  if (details.reason === "install") {
    ext.runtime.openOptionsPage();
  }
});

ext.runtime.onStartup.addListener(() => {
  schedule();
  showUnsentCount();
  showLanguage();
  deliverAndRead();
  tidySent().catch(() => {});
});

// On the same beat, sent captures past their thirty days leave the browser (#54).
ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    deliverAndRead();
    tidySent().catch(() => {});
  }
});

ext.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  // The icon follows the settings and what was learnt of the connection, the number the captures.
  if (Object.keys(changes).some(isCaptureKey) || changes.connection || changes.offline || changes.instance || changes.token) {
    recount();
  }
  if (changes.language) {
    showLanguage();
  }
  // Turning the testing switch off, or saving an address, is a moment Postulo may be
  // reachable where it was not. What was learnt of another Postulo, or of another token,
  // is not this one's, so it is dropped and learnt again.
  if (changes.instance || changes.token) {
    forgetConnection().then(deliverAndRead);
  } else if (changes.offline && changes.offline.newValue === false) {
    deliverAndRead();
  }
  // A list read from another Postulo, or with another token, is not this one's.
  if (changes.instance || changes.token) {
    forgetWaitingList();
  }
});

// The address is allowed or no longer allowed: the first moment to know it can be asked, or not.
ext.permissions.onAdded.addListener(() => checkPostulo());
ext.permissions.onRemoved.addListener(() => checkPostulo());
