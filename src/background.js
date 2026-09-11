// The background: opening the settings on first install, and sending what is waiting.
//
// It never reads a page and never decides to send anything. A capture reaches here only
// once somebody has pressed Send; what the background adds is trying again when Postulo
// could not be reached then: every few minutes, and when the browser starts.

import { ext } from "./lib/browser.js";
import { deliverWaiting, showUnsentCount } from "./lib/local.js";
import { isCaptureKey } from "./lib/store.js";

const ALARM = "deliver";
const EVERY_MINUTES = 5;

function schedule() {
  // Creating an alarm that exists replaces it, so this is safe to repeat.
  ext.alarms.create(ALARM, { periodInMinutes: EVERY_MINUTES });
}

ext.runtime.onInstalled.addListener((details) => {
  schedule();
  showUnsentCount();
  if (details.reason === "install") {
    ext.runtime.openOptionsPage();
  }
});

ext.runtime.onStartup.addListener(() => {
  schedule();
  showUnsentCount();
  deliverWaiting();
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    deliverWaiting();
  }
});

ext.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (Object.keys(changes).some(isCaptureKey)) {
    showUnsentCount();
  }
  // Turning the testing switch off, or saving an address, is a moment Postulo may be
  // reachable where it was not.
  if ((changes.offline && changes.offline.newValue === false) || changes.instance || changes.token) {
    deliverWaiting();
  }
});
