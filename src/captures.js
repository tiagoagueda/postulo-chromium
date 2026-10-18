import { askAndKeep } from "./lib/allow.js";
import { originPattern } from "./lib/api.js";
import { onInstance } from "./lib/rendering.js";
import { ext, loadSettings, requestHostPermission } from "./lib/browser.js";
import { explain, localise, t, useStoredLanguage } from "./lib/i18n.js";
import { afterSending, deliverWaiting, log, showUnsentCount, store } from "./lib/local.js";
import { isCaptureKey, UNSENT } from "./lib/store.js";
import { openInReviewWindow, reviewPageUrl } from "./lib/window.js";

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
  let declined = false;
  try {
    // The request starts from the click, and the records are marked in the same tick.
    ids = await askAndKeep(allowFromClick(), async () => {
      const list = typeof ids === "function" ? await ids() : ids;
      for (const id of list) {
        await store.update(id, { state: "waiting", problem: null });
        await log.add("to send", { id });
      }
      return list;
    }, () => {
      declined = true;
    });
    if (ids.length) {
      await deliverAndSay(ids, declined);
    }
  } catch (error) {
    say(explain(error), true);
  }
}

async function deliverAndSay(ids, declined = false) {
  say(t("sending"));
  const result = await deliverWaiting(ids);
  const records = await Promise.all(ids.map((id) => store.get(id)));
  const refused = records.filter((record) => record && record.state === "refused");
  if (refused.length) {
    say(explain(refused[0].problem), true);
  } else if (records.every((record) => record && record.state === "sent")) {
    say(t("captured"));
  } else if (declined) {
    say(t("permissionRefused"), true);
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
  const reviewAddress = record.state === "sent" ? onInstance(record.reviewUrl, settings && settings.instance) : "";
  if (record.state === "sent") {
    // Postulo's own page opens in the review window, where its "Save and next" walks the
    // queue. Only an address on the instance's own origin (SEC2-079).
    if (reviewAddress) {
      const review = element("a", { href: reviewAddress, target: "_blank", rel: "noopener", className: "button primary" }, t("review"));
      review.addEventListener("click", (event) => {
        event.preventDefault();
        openInReviewWindow(reviewAddress).catch((error) => say(explain(error), true));
      });
      actions.append(review);
    }
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
    // One editor, in the review window, for this list and the popup alike.
    actions.append(button(t("edit"), () => openInReviewWindow(reviewPageUrl(record.id)).catch((error) => say(explain(error), true)), false, "edit"));
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

async function draw() {
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
  await useStoredLanguage();
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
    if (changes.language) {
      // The list is drawn again in the new language.
      await useStoredLanguage();
      localise();
      draw();
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
