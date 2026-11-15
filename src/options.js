import { extraScopes, normaliseInstance, originPattern, whoAmI } from "./lib/api.js";
import { ext, loadSettings, requestHostPermission, setLanguage, setOffline } from "./lib/browser.js";
import { explain, localise, localiseWith, t, useLanguage, useStoredLanguage } from "./lib/i18n.js";
import { LANGUAGES } from "./lib/languages.js";
import { learnFromCall, log, store } from "./lib/local.js";
import { forgetPostulo, saveConnection } from "./lib/settings.js";
import { hostOf } from "./lib/log.js";

const $ = (id) => document.getElementById(id);

function say(text, isError = false) {
  const status = $("status");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function values() {
  return {
    instance: normaliseInstance($("instance").value),
    token: $("token").value.trim(),
  };
}

function element(tag, text) {
  const made = document.createElement(tag);
  made.textContent = text;
  return made;
}

/** The two sentences that carry markup: a menu path, a scope, a keyboard shortcut. */
function localiseHints() {
  // `captures` is the scope's name in Postulo, the same in every language.
  localiseWith($("token-hint"), "tokenHint", [element("em", t("tokenPath")), element("code", "captures")]);
  const shortcut = document.createElement("span");
  shortcut.append(element("kbd", "Alt"), "+", element("kbd", "Shift"), "+", element("kbd", "P"));
  localiseWith($("shortcut-hint"), "shortcutHint", [shortcut]);
}

/** The languages to pick from, each named in itself and marked as that language for a screen reader. */
function listLanguages() {
  for (const language of LANGUAGES) {
    const option = element("option", language.name);
    option.value = language.tag;
    option.lang = language.tag;
    $("language").append(option);
  }
}

/** The log as a file, headed by what somebody helping would ask first. */
async function downloadLog() {
  const settings = await loadSettings();
  const counts = {};
  for (const record of await store.list()) {
    counts[record.state] = (counts[record.state] || 0) + 1;
  }
  const now = new Date();
  const text = await log.text({
    extension: ext.runtime.getManifest().version,
    browser: navigator.userAgent,
    language: t("languageTag"),
    // The host alone: the log is the kind of file that gets attached to an issue (SEC2-076).
    postulo: settings.instance ? hostOf(settings.instance) : "(not set up)",
    "testing switch": settings.offline ? "on" : "off",
    captures: JSON.stringify(counts),
    written: now.toISOString(),
  });
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `postulo-extension-log-${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function main() {
  await useStoredLanguage();
  localise();
  localiseHints();
  listLanguages();
  const settings = await loadSettings();
  // A language stored but no longer shipped is not in the list: the select then shows "Follow
  // the browser", the stored value stays as it is, and so does the language in use.
  $("language").value = LANGUAGES.some((one) => one.tag === settings.language) ? settings.language : "";
  $("instance").value = settings.stored;
  if (settings.refused) {
    say(t(settings.refused), true);
  }
  $("token").value = settings.token;
  $("offline").checked = settings.offline;

  $("settings").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const next = values();
      if (!next.token) {
        throw new Error(t("tokenMissing"));
      }
      // The manifest cannot list an address it does not know yet, so the instance's origin
      // is asked for here, from the click that saves it. Firefox insists on this; Chromium
      // is happy either way.
      const granted = await requestHostPermission(originPattern(next.instance));
      // The token's scopes are asked while the address is allowed: one wider than `captures`
      // is not stored. A Postulo that cannot be reached is no reason to refuse: the
      // background's own check says it later (SEC3-011).
      if (granted) {
        let me = null;
        try {
          me = await whoAmI(next.instance, next.token);
        } catch {
          // Stored as before.
        }
        const extra = extraScopes(me);
        if (extra.length) {
          throw new Error(t("tokenTooWide", [extra.join(", ")]));
        }
      }
      // What waited for another address goes back to kept first: saving wakes the delivery.
      const released = await saveConnection({ area: ext.storage.local, store, next });
      await log.add("settings saved", { postulo: hostOf(next.instance), permission: granted, released });
      if (released) {
        say(t("savedOtherAddress", [String(released)]), !granted);
      } else {
        say(granted ? t("saved", [new URL(next.instance).host]) : t("savedNoPermission"), !granted);
      }
    } catch (error) {
      say(explain(error), true);
    }
  });

  // Leaving a Postulo: its address, token and host permission go, the captures stay (SEC3-015).
  $("forget").addEventListener("click", async () => {
    try {
      const origin = await forgetPostulo({ area: ext.storage.local, store });
      if (origin) {
        await ext.permissions.remove({ origins: [originPattern(origin)] }).catch(() => {});
      }
      $("instance").value = "";
      $("token").value = "";
      await log.add("forgotten", {});
      say(t("forgotten"));
    } catch (error) {
      say(explain(error), true);
    }
  });

  $("test").addEventListener("click", async () => {
    try {
      const next = values();
      if ($("offline").checked) {
        say(t("offlineOn"));
        return;
      }
      say(t("asking"));
      const granted = await requestHostPermission(originPattern(next.instance));
      if (!granted) {
        throw new Error(t("addressRefused"));
      }
      // What Test learns about the connection counts only when it asked the saved address
      // with the saved token, not what is merely typed.
      const saved = await loadSettings();
      const saves = saved.instance === next.instance && saved.token === next.token;
      let me;
      try {
        me = await whoAmI(next.instance, next.token);
      } catch (error) {
        if (saves) {
          await learnFromCall("test", error);
        }
        throw error;
      }
      if (saves) {
        await learnFromCall("test");
      }
      const scopes = (me.scopes || []).join(", ");
      const canCapture = (me.scopes || []).includes("captures");
      await log.add("test", { postulo: hostOf(next.instance), scopes });
      const who = scopes ? t("tokenIsScoped", [me.name, me.owner, scopes]) : t("tokenIs", [me.name, me.owner]);
      // The extension keeps its token unencrypted in the browser's storage, and the threat
      // model assumes it holds `captures` and nothing else (SEC2-081).
      const extra = extraScopes(me);
      if (extra.length) {
        say(`${who} ${t("tokenTooWide", [extra.join(", ")])}`, true);
        return;
      }
      say(canCapture ? who : `${who} ${t("lacksCaptures")}`, !canCapture);
    } catch (error) {
      await log.add("test", { outcome: "failed", status: error.status || "no answer", problem: error.key || error.message });
      say(explain(error), true);
    }
  });

  // Takes effect at once, without Save: it is a switch for trying things, not a setting.
  $("offline").addEventListener("change", async () => {
    const offline = $("offline").checked;
    await setOffline(offline);
    await log.add("testing switch", { offline });
    say(offline ? t("offlineOn") : t("offlineOff"));
  });

  // Takes effect at once, like the switch above; the open pages follow through the storage change.
  $("language").addEventListener("change", async () => {
    const language = $("language").value;
    await setLanguage(language);
    await useLanguage(language);
    localise();
    localiseHints();
    say("");
    await log.add("language", { language: language || "(browser's)" });
  });

  $("download-log").addEventListener("click", downloadLog);
  $("clear-log").addEventListener("click", async () => {
    await log.clear();
    say(t("logCleared"));
  });
}

main();
