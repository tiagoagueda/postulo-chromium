import { capture, describe, originPattern } from "./lib/api.js";
import { ext, hasHostPermission, loadSettings, readCurrentTab, requestHostPermission } from "./lib/browser.js";
import { explain, localise, t } from "./lib/i18n.js";

const $ = (id) => document.getElementById(id);

function show(section) {
  for (const id of ["unconfigured", "ready", "result"]) {
    $(id).hidden = id !== section;
  }
}

function say(text, isError = false) {
  const status = $("status");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

async function main() {
  localise();
  const settings = await loadSettings();
  $("open-options").addEventListener("click", () => ext.runtime.openOptionsPage());
  $("options-link").addEventListener("click", () => ext.runtime.openOptionsPage());

  if (!settings.instance || !settings.token) {
    show("unconfigured");
    return;
  }

  show("ready");
  // Where a capture goes, in the corner rather than above the button: always visible, never
  // in the way, and a click away from the instance itself.
  const server = $("server");
  server.textContent = settings.instance;
  server.title = settings.instance;
  server.href = settings.instance;
  server.hidden = false;

  $("capture").addEventListener("click", async () => {
    const button = $("capture");
    button.disabled = true;
    say(t("reading"));
    try {
      const pattern = originPattern(settings.instance);
      if (!(await hasHostPermission(pattern))) {
        say(t("allowing"));
        const granted = await requestHostPermission(pattern);
        if (!granted) {
          throw new Error(t("noPermission"));
        }
      }
      const page = await readCurrentTab();
      say(t("sending"));
      const result = await capture(settings.instance, settings.token, page);
      $("summary").textContent = describe(result, t("untitled"));
      $("read-by").textContent = result.source ? t("readBy", [result.source]) : "";
      $("review").href = result.review_url;
      show("result");
      say(t("captured"));
    } catch (error) {
      say(explain(error), true);
      button.disabled = false;
    }
  });
}

main();
