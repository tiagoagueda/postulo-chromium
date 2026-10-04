import { askAndKeep } from "./lib/allow.js";
import { originPattern } from "./lib/api.js";
import { ext, loadSettings, requestHostPermission } from "./lib/browser.js";
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

function button(label, onClick, primary = false, action = "") {
  const made = element("button", { type: "button", className: primary ? "primary" : "", ...(action ? { "data-action": action } : {}) }, label);
  made.addEventListener("click", onClick);
  return made;
}

let settings = null;
let editing = null; // the id whose editor is open: a redraw waits for it to close
let redrawLater = false;

/** The permission request for the click, or null when sending needs none. */
function allowFromClick() {
  if (!settings.instance || !settings.token || settings.offline) {
    return null;
  }
  return () => {
    say(t("allowing"));
    return requestHostPermission(originPattern(settings.instance));
  };
}

/** `ids` is a list, or a function giving the list: it is read after the request has started,
 *  because nothing may be awaited before that. */
async function send(ids) {
  try {
    // The request starts from the click, and the records are marked in the same tick.
    ids = await askAndKeep(allowFromClick(), async () => {
      const list = typeof ids === "function" ? await ids() : ids;
      for (const id of list) {
        await store.update(id, { state: "waiting", problem: null });
        await log.add("to send", { id });
      }
      return list;
    });
    if (ids.length) {
      await deliverAndSay(ids);
    }
  } catch (error) {
    say(explain(error), true);
  }
}

async function deliverAndSay(ids) {
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
    { className: `capture state-${record.state}`, "data-id": record.id },
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
      button(t("tryNow"), () => send([record.id]), true, "send"),
      button(t("holdBack"), async () => {
        await store.update(record.id, { state: "kept" });
        await log.add("held back", { id: record.id });
      }, false, "hold"),
    );
  } else {
    actions.append(button(t("sendForReview"), () => send([record.id]), true, "send"));
  }
  if (record.state !== "sent") {
    actions.append(button(t("edit"), () => openEditor(li, record), false, "edit"));
  }
  actions.append(
    button(t("delete"), async () => {
      // A sent capture is in Postulo already; one that is not exists only here.
      if (UNSENT.has(record.state) && !window.confirm(t("deleteConfirm"))) {
        return;
      }
      await store.remove(record.id);
      await log.add("deleted", { id: record.id, state: record.state });
    }, false, "delete"),
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
    // Save or Cancel went with the panel: put focus back on the item's Edit button.
    li.querySelector('[data-action="edit"]')?.focus();
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
          try {
            await store.update(record.id, { data: editor.values(latest.data), state, problem: state === "kept" ? null : latest.problem });
          } catch (error) {
            say(explain(error), true);
            return;
          }
          await log.add("edited", { id: record.id });
          close();
        },
        true,
        "save",
      ),
      button(t("cancel"), close, false, "cancel"),
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
  const list = $("list");
  // A redraw replaces every item, and the focused button with it: note where focus was.
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const focusedId = focused?.closest("[data-id]")?.dataset.id;
  const focusedAction = focused?.dataset.action;
  const before = [...list.children].map((li) => li.dataset.id);
  list.replaceChildren(...records.map((record) => item(record, when)));
  if (focusedId) {
    const find = (id) => [...list.children].find((li) => li.dataset.id === id);
    let target = find(focusedId)?.querySelector(`[data-action="${focusedAction}"]`);
    if (!target) {
      // The control or its item is gone: the next item still here, else the one before.
      const at = before.indexOf(focusedId);
      const near = [...before.slice(at + 1), ...before.slice(0, at).reverse()].map(find).find(Boolean);
      target = (find(focusedId) || near)?.querySelector("button, a") || document.querySelector("h1");
    }
    if (target) {
      if (target.tagName === "H1") {
        target.tabIndex = -1;
      }
      target.focus();
    }
  }
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
    await send(async () =>
      (await store.list()).filter((record) => record.state === "kept" || record.state === "refused").map((record) => record.id),
    );
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
