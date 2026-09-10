import { normaliseInstance, originPattern, whoAmI } from "./lib/api.js";
import { loadSettings, requestHostPermission, saveSettings } from "./lib/browser.js";
import { explain, localise, localiseWith, t } from "./lib/i18n.js";

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

async function main() {
  localise();
  localiseHints();
  const settings = await loadSettings();
  $("instance").value = settings.instance;
  $("token").value = settings.token;

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
      say(t("asking"));
      const granted = await requestHostPermission(originPattern(next.instance));
      if (!granted) {
        throw new Error(t("addressRefused"));
      }
      const me = await whoAmI(next.instance, next.token);
      const scopes = (me.scopes || []).join(", ");
      const canCapture = (me.scopes || []).includes("captures");
      const who = scopes ? t("tokenIsScoped", [me.name, me.owner, scopes]) : t("tokenIs", [me.name, me.owner]);
      say(canCapture ? who : `${who} ${t("lacksCaptures")}`, !canCapture);
    } catch (error) {
      say(explain(error), true);
    }
  });
}

main();
