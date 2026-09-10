import { capture, corrections, describe, originPattern, preview } from "./lib/api.js";
import { ext, hasHostPermission, loadSettings, readCurrentTab, requestHostPermission } from "./lib/browser.js";
import { explain, localise, t } from "./lib/i18n.js";

const $ = (id) => document.getElementById(id);

/** The posting's fields the popup shows, by the names Postulo's API gives them. */
const FIELDS = [
  "title",
  "company_name",
  "location",
  "remote_type",
  "employment_type",
  "salary_min",
  "salary_max",
  "salary_currency",
  "salary_period",
  "closes_at",
  "description",
];

function show(section) {
  for (const id of ["unconfigured", "ready", "edit", "result"]) {
    $(id).hidden = id !== section;
  }
  // The form needs more room than a button does.
  document.body.classList.toggle("wide", section === "edit");
}

function say(text, isError = false) {
  const status = $("status");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

/** Put what was read into the form. */
function fill(form, data) {
  for (const name of FIELDS) {
    const field = form.elements[name];
    const value = data[name] ?? "";
    // A value a source wrote that the list has no word for is shown as it is, not dropped:
    // choosing nothing would send a correction nobody made.
    if (field instanceof HTMLSelectElement && value && ![...field.options].some((option) => option.value === value)) {
      field.add(new Option(value, value));
    }
    field.value = value;
  }
}

/** What the form says now. */
function edited(form) {
  const values = Object.fromEntries(FIELDS.map((name) => [name, form.elements[name].value]));
  values.salary_currency = values.salary_currency.trim().toUpperCase();
  return values;
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

  // The page as read once, and what Postulo made of it: sending sends this same page, so
  // what is kept is what was shown, whatever the tab has done since.
  let page = null;
  let read = null;

  async function send(data) {
    say(t("sending"));
    const result = await capture(settings.instance, settings.token, { ...page, data });
    $("summary").textContent = describe(result, t("untitled"));
    $("read-by").textContent = result.source ? t("readBy", [result.source]) : "";
    $("review").href = result.review_url;
    show("result");
    say(t("captured"));
  }

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
      page = await readCurrentTab();
      say(t("previewing"));
      const seen = await preview(settings.instance, settings.token, page);
      if (!seen) {
        // A Postulo from before the preview: nothing to show, so it goes as it always did.
        await send();
        return;
      }
      read = seen.data;
      fill($("posting"), read);
      $("edit-read-by").textContent = seen.source ? t("readBy", [seen.source]) : "";
      show("edit");
      say("");
      $("f-title").focus();
    } catch (error) {
      say(explain(error), true);
      button.disabled = false;
    }
  });

  $("posting").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("send");
    button.disabled = true;
    try {
      await send(corrections(read, edited($("posting"))));
    } catch (error) {
      say(explain(error), true);
      button.disabled = false;
    }
  });
}

main();
