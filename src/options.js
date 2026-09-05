import { normaliseInstance, originPattern, whoAmI } from "./lib/api.js";
import { loadSettings, requestHostPermission, saveSettings } from "./lib/browser.js";

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

async function main() {
  const settings = await loadSettings();
  $("instance").value = settings.instance;
  $("token").value = settings.token;

  $("settings").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const next = values();
      if (!next.token) {
        throw new Error("Paste the token Postulo showed you.");
      }
      // The manifest cannot list an address it does not know yet, so the instance's origin
      // is asked for here, from the click that saves it. Firefox insists on this; Chromium
      // is happy either way.
      const granted = await requestHostPermission(originPattern(next.instance));
      await saveSettings(next);
      say(
        granted
          ? "Saved. The button will now send pages to " + new URL(next.instance).host + "."
          : "Saved, but the browser refused permission to reach it; allow it in the extension's permissions.",
        !granted
      );
    } catch (error) {
      say(error.message || String(error), true);
    }
  });

  $("test").addEventListener("click", async () => {
    try {
      const next = values();
      say("Asking Postulo who this token is…");
      const granted = await requestHostPermission(originPattern(next.instance));
      if (!granted) {
        throw new Error("Permission to reach that address was refused.");
      }
      const me = await whoAmI(next.instance, next.token);
      const scopes = (me.scopes || []).join(", ");
      const canCapture = (me.scopes || []).includes("captures");
      say(
        `Token "${me.name}" for ${me.owner}${scopes ? " (" + scopes + ")" : ""}.` +
          (canCapture ? "" : " It lacks the captures scope, so it cannot capture."),
        !canCapture
      );
    } catch (error) {
      say(error.message || String(error), true);
    }
  });
}

main();
