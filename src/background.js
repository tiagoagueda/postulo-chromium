// The background: opening the settings on first install, and sending what is waiting.
//
// It never reads a page and never decides to send anything. A capture reaches here only
// once somebody has pressed Send; what the background adds is trying again when Postulo
// could not be reached then: every few minutes, and when the browser starts. On the same
// beat it reads the list of captures waiting for review in Postulo, for the number on the
// toolbar button.

import { ext } from "./lib/browser.js";
import { deliverWaiting, forgetWaitingList, readWaitingList, showLanguage, showUnsentCount } from "./lib/local.js";
import { isCaptureKey } from "./lib/store.js";

const ALARM = "deliver";
const EVERY_MINUTES = 5;

/** Send what is waiting, then read Postulo's list unless sending already did. */
async function deliverAndRead() {
  const result = await deliverWaiting();
  if (!result.sent) {
    await readWaitingList();
  }
}

function schedule() {
  // Creating an alarm that exists replaces it, so this is safe to repeat.
  ext.alarms.create(ALARM, { periodInMinutes: EVERY_MINUTES });
}

ext.runtime.onInstalled.addListener((details) => {
  schedule();
  showUnsentCount();
  showLanguage();
  if (details.reason === "install") {
    ext.runtime.openOptionsPage();
  }
});

ext.runtime.onStartup.addListener(() => {
  schedule();
  showUnsentCount();
  showLanguage();
  deliverAndRead();
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    deliverAndRead();
  }
});

ext.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (Object.keys(changes).some(isCaptureKey)) {
    showUnsentCount();
  }
  if (changes.language) {
    showLanguage();
  }
  // Turning the testing switch off, or saving an address, is a moment Postulo may be
  // reachable where it was not.
  if ((changes.offline && changes.offline.newValue === false) || changes.instance || changes.token) {
    deliverAndRead();
  }
  // A list read from another Postulo, or with another token, is not this one's.
  if (changes.instance || changes.token) {
    forgetWaitingList();
  }
});
