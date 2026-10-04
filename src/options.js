import { normaliseInstance, originPattern, whoAmI } from "./lib/api.js";
import { ext, loadSettings, requestHostPermission, saveSettings, setLanguage, setOffline } from "./lib/browser.js";
import { explain, localise, localiseWith, t, useLanguage, useStoredLanguage } from "./lib/i18n.js";
import { LANGUAGES } from "./lib/languages.js";
import { log, store } from "./lib/local.js";
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
    postulo: settings.instance || "(not set up)",
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
  $("instance").value = settings.instance;
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
      await saveSettings(next);
      await log.add("settings saved", { postulo: hostOf(next.instance), permission: granted });
      say(
        granted ? t("saved", [new URL(next.instance).host]) : t("savedNoPermission"),
        !granted
      );
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
      const me = await whoAmI(next.instance, next.token);
      const scopes = (me.scopes || []).join(", ");
      const canCapture = (me.scopes || []).includes("captures");
      await log.add("test", { postulo: hostOf(next.instance), scopes });
      const who = scopes ? t("tokenIsScoped", [me.name, me.owner, scopes]) : t("tokenIs", [me.name, me.owner]);
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
