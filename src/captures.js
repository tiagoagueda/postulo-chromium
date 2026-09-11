import { originPattern } from "./lib/api.js";
import { ext, hasHostPermission, loadSettings, requestHostPermission } from "./lib/browser.js";
import { postingForm } from "./lib/form.js";
import { explain, localise, t } from "./lib/i18n.js";
import { afterSending, deliverWaiting, log, showUnsentCount, store } from "./lib/local.js";
import { isCaptureKey, UNSENT } from "./lib/store.js";

const $ = (id) => document.getElementById(id);

function say(text, isError = false) {
  const status = $("status");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function element(tag, attributes = {}, ...children) {
  const made = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "className") {
      made.className = value;
    } else {
      made.setAttribute(name, value);
    }
  }
  made.append(...children.filter((child) => child !== null && child !== undefined && child !== ""));
  return made;
}

function button(label, onClick, primary = false) {
  const made = element("button", { type: "button", className: primary ? "primary" : "" }, label);
  made.addEventListener("click", onClick);
  return made;
}

let settings = null;
let editing = null; // the id whose editor is open: a redraw waits for it to close
let redrawLater = false;

/** Ask for the instance's origin from this click, if sending needs it and it is missing. */
async function allowFromClick() {
  if (!settings.instance || !settings.token || settings.offline) {
    return;
  }
  const pattern = originPattern(settings.instance);
  if (!(await hasHostPermission(pattern))) {
    await requestHostPermission(pattern);
  }
}

async function send(ids) {
  await allowFromClick();
  for (const id of ids) {
    await store.update(id, { state: "waiting", problem: null });
    await log.add("to send", { id });
  }
  say(t("sending"));
  const result = await deliverWaiting(ids);
  const records = await Promise.all(ids.map((id) => store.get(id)));
  const refused = records.filter((record) => record && record.state === "refused");
  if (refused.length) {
    say(explain(refused[0].problem), true);
  } else if (records.every((record) => record && record.state === "sent")) {
    say(t("captured"));
  } else {
    say(...afterSending(result));
  }
}

function stateLabel(state) {
  return { kept: t("stateKept"), waiting: t("stateWaiting"), sent: t("stateSent"), refused: t("stateRefused") }[state];
}

function item(record, when) {
  const title = record.data.title || t("untitled");
  const where = [record.data.company_name, record.data.location].filter(Boolean).join(", ");
  const meta = [where, when.format(new Date(record.capturedAt)), record.source ? t("readBy", [record.source]) : ""]
    .filter(Boolean)
    .join(" · ");
  const li = element(
    "li",
    { className: `capture state-${record.state}` },
    element(
      "div",
      { className: "line" },
      element("a", { href: record.url, target: "_blank", rel: "noopener", className: "title" }, title),
      element("span", { className: "chip" }, stateLabel(record.state)),
    ),
    element("p", { className: "meta" }, meta),
    record.problem && record.state !== "sent" ? element("p", { className: "problem" }, explain(record.problem)) : null,
  );

  const actions = element("div", { className: "actions" });
  if (record.state === "sent") {
    actions.append(element("a", { href: record.reviewUrl, target: "_blank", rel: "noopener", className: "button primary" }, t("review")));
  } else if (record.state === "waiting") {
    actions.append(
      button(t("tryNow"), () => send([record.id]), true),
      button(t("holdBack"), async () => {
        await store.update(record.id, { state: "kept" });
        await log.add("held back", { id: record.id });
      }),
    );
  } else {
    actions.append(button(t("sendForReview"), () => send([record.id]), true));
  }
  if (record.state !== "sent") {
    actions.append(button(t("edit"), () => openEditor(li, record)));
  }
  actions.append(
    button(t("delete"), async () => {
      // A sent capture is in Postulo already; one that is not exists only here.
      if (UNSENT.has(record.state) && !window.confirm(t("deleteConfirm"))) {
        return;
      }
      await store.remove(record.id);
      await log.add("deleted", { id: record.id, state: record.state });
    }),
  );
  li.append(actions);
  return li;
}

function openEditor(li, record) {
  if (editing) {
    return;
  }
  editing = record.id;
  const editor = postingForm();
  editor.fill(record.data);
  const close = () => {
    editing = null;
    panel.remove();
    if (redrawLater) {
      redrawLater = false;
      draw();
    }
  };
  const panel = element(
    "div",
    { className: "editor" },
    editor.form,
    element(
      "div",
      { className: "actions" },
      button(
        t("save"),
        async () => {
          if (!editor.form.reportValidity()) {
            return;
          }
          const latest = await store.get(record.id);
          if (!latest) {
            close();
            return;
          }
          // Changed after a refusal, it is kept again, to be sent when the person says.
          const state = latest.state === "refused" ? "kept" : latest.state;
          await store.update(record.id, { data: editor.values(latest.data), state, problem: state === "kept" ? null : latest.problem });
          await log.add("edited", { id: record.id });
          close();
        },
        true,
      ),
      button(t("cancel"), close),
    ),
  );
  li.append(panel);
  editor.focus();
}

async function draw() {
  if (editing) {
    redrawLater = true;
    return;
  }
  const records = await store.list();
  const when = new Intl.DateTimeFormat(t("languageTag"), { dateStyle: "medium", timeStyle: "short" });
  $("list").replaceChildren(...records.map((record) => item(record, when)));
  $("empty").hidden = records.length > 0;
  $("send-all").disabled = !records.some((record) => record.state === "kept" || record.state === "refused");
  $("clear-sent").disabled = !records.some((record) => record.state === "sent");
}

async function main() {
  localise();
  settings = await loadSettings();
  $("not-connected").hidden = Boolean(settings.instance && settings.token);
  $("offline-on").hidden = !settings.offline;
  $("open-options").addEventListener("click", () => ext.runtime.openOptionsPage());

  $("send-all").addEventListener("click", async () => {
    const ids = (await store.list()).filter((record) => record.state === "kept" || record.state === "refused").map((record) => record.id);
    if (ids.length) {
      await send(ids);
    }
  });
  $("clear-sent").addEventListener("click", async () => {
    for (const record of await store.list()) {
      if (record.state === "sent") {
        await store.remove(record.id);
      }
    }
    await log.add("cleared sent");
  });

  ext.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") {
      return;
    }
    if (changes.offline || changes.instance || changes.token) {
      settings = await loadSettings();
      $("not-connected").hidden = Boolean(settings.instance && settings.token);
      $("offline-on").hidden = !settings.offline;
    }
    if (Object.keys(changes).some(isCaptureKey)) {
      draw();
      showUnsentCount();
    }
  });

  await draw();
  deliverWaiting().then(() => {}, () => {});
}

main();
