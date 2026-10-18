import { describe, newListingUrl, originPattern } from "./lib/api.js";
import { askAndKeep } from "./lib/allow.js";
import { ext, loadSettings, readCurrentTab, requestHostPermission, tabProblem } from "./lib/browser.js";
import { explain, localise, t, useStoredLanguage } from "./lib/i18n.js";
import { postingForm } from "./lib/form.js";
import { askKnown } from "./lib/known.js";
import { afterSending, checkPostulo, deliverWaiting, log, openCaptures, readWaitingList, showUnsentCount, store } from "./lib/local.js";
import { CONNECTION, SLOW_MS, footerFor, toolbarFor } from "./lib/connection.js";
import { hostOf } from "./lib/log.js";
import { emptyPosting, readPosting, readPostings, slimPage } from "./lib/parse.js";
import { onInstance } from "./lib/rendering.js";
import { reviewRows } from "./lib/review.js";
import { waitingCopy } from "./lib/waiting.js";
import { openInReviewWindow, reviewPageUrl } from "./lib/window.js";

const $ = (id) => document.getElementById(id);

function show(section) {
  for (const id of ["ready", "pick", "result"]) {
    $(id).hidden = id !== section;
  }
  const working = section === "pick";
  // A list needs more room than a button does.
  document.body.classList.toggle("wide", working);
  // And all the height a popup gets: the link to the list waits until it is done.
  $("captures-link").parentElement.hidden = working;
  // The header's buttons follow: capturing waits for the list again, adding by hand for the ticking.
  $("capture").hidden = section !== "ready";
  $("add-listing").hidden = working || !connected;
  $("review-list").hidden = working || !reviewShown;
  // The notes about the connection too: what became of a capture is said once it is sent.
  for (const id of ["not-connected", "offline-on"]) {
    $(id).classList.toggle("folded", working);
  }
}

let connected = false; // whether there is a Postulo to open
let reviewShown = false; // whether the list of captures needing review has anything to say

function say(text, isError = false) {
  const status = $("status");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

async function showCount() {
  await showUnsentCount();
  await showReviewList();
}

/** The captures that need review, as the badge counts them: from the copy of Postulo's
 *  list and the captures here, so offline too, and drawn again when a read lands. */
async function showReviewList() {
  const settings = await loadSettings();
  const copy = await waitingCopy(ext.storage.local, settings);
  const { rows, total } = reviewRows(copy ? copy.rows : [], await store.list());
  const connection = (await ext.storage.local.get(CONNECTION))[CONNECTION];
  const when = new Date(copy ? copy.at : 0);
  // The last list Postulo gave stands in for it while it cannot be asked: a row may have
  // been decided meanwhile, and this line is the only warning.
  const stale = Boolean(copy) && toolbarFor(settings, connection).state !== "reachable";
  $("review-stale").hidden = !stale;
  $("review-stale").textContent = stale ? t("lastListed", [when.toLocaleString(t("languageTag"), { dateStyle: "long", timeStyle: "short" })]) : "";
  $("review-empty").hidden = total > 0;
  const day = (iso) => (Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString(t("languageTag")) : "");
  // Only an address on the instance's own origin is followed out of the popup; anything
  // else Postulo's copy holds falls back to this extension's own list (SEC2-079).
  const web = (address) => Boolean(onInstance(address, settings.instance));
  $("review-rows").replaceChildren(
    ...rows.map((row) => {
      const where = [row.company_name, row.location].filter(Boolean).join(", ");
      const state = row.kind === "postulo" ? t("waitingInPostulo") : { kept: t("stateKept"), waiting: t("stateWaiting"), refused: t("stateRefused") }[row.state];
      const link = document.createElement("a");
      // A row opens outside the popup, in the review window: Postulo's review page, or the
      // form of the capture kept here. Anything else Postulo's copy holds falls back to this
      // extension's own list, in a tab.
      const inWindow = row.kind !== "postulo" || web(row.link);
      link.href = row.kind === "postulo" ? (web(row.link) ? onInstance(row.link, settings.instance) : ext.runtime.getURL("captures.html")) : reviewPageUrl(row.id);
      if (inWindow) {
        link.addEventListener("click", (event) => {
          event.preventDefault();
          openInReviewWindow(link.href).then(() => window.close(), (error) => say(explain(error), true));
        });
      } else {
        link.target = "_blank";
        link.rel = "noopener";
      }
      const lines = [row.title || t("untitled"), [where, day(row.at)].filter(Boolean).join(" · "), state, row.count > 1 ? t("capturesOfPosting", [String(row.count)]) : ""];
      lines.filter(Boolean).forEach((text, index) => {
        const line = document.createElement("span");
        line.className = index ? "meta" : "title";
        line.textContent = text;
        link.append(line);
      });
      const item = document.createElement("li");
      item.append(link);
      return item;
    }),
  );
  reviewShown = true;
  $("review-list").hidden = $("ready").hidden;
}

/** Draw the footer's state before the address from the settings and the connection record,
 *  and say it in words for a screen reader and the tooltip. */
let drawing = 0; // the latest draw wins, whatever order the storage reads return in

async function showState(settings, live = {}) {
  const turn = ++drawing;
  const record = (await ext.storage.local.get(CONNECTION))[CONNECTION];
  if (turn !== drawing) {
    return;
  }
  const shown = footerFor(settings, record, live);
  const state = $("state");
  state.hidden = !shown;
  if (!shown) {
    return;
  }
  const words = shown.state === "tokenRefused" ? t("tokenRefused", [t("tokenPath")]) : t(shown.key);
  state.dataset.state = shown.state;
  state.title = words;
  state.setAttribute("aria-label", words);
  for (const shape of state.querySelectorAll("svg")) {
    shape.hidden = shape.dataset.state !== shown.state;
  }
}

/** Show what is known at once, then ask once whether Postulo answers and show that. A
 *  second without an answer shows slow while the 20 s wait goes on; a popup closed before
 *  the answer writes nothing, and the next check in the background decides. */
async function watchState(settings) {
  await showState(settings);
  if (!settings.instance || !settings.token || settings.offline) {
    return;
  }
  const timer = setTimeout(() => showState(settings, { slow: true }), SLOW_MS);
  try {
    await checkPostulo();
  } catch {
    // The record keeps what it knew; the footer shows that.
  }
  clearTimeout(timer);
  await showState(settings);
}

async function main() {
  await useStoredLanguage();
  localise();
  const settings = await loadSettings();
  connected = Boolean(settings.instance && settings.token);
  $("open-options").addEventListener("click", () => ext.runtime.openOptionsPage());
  $("options-link").addEventListener("click", () => ext.runtime.openOptionsPage());
  $("captures-link").addEventListener("click", (event) => {
    event.preventDefault();
    openCaptures();
    window.close();
  });

  $("not-connected").hidden = connected;
  $("offline-on").hidden = !settings.offline;
  if (connected) {
    // Where a capture goes, in the corner: always visible, never in the way.
    const server = $("server");
    server.textContent = settings.instance;
    server.title = settings.instance;
    server.href = settings.instance;
    server.hidden = false;
    watchState(settings).catch(() => {});
  }
  show("ready");
  // The tab is tested now, not on the press: a disabled button is not reached by the keyboard,
  // so the sentence is text. Pages closed to extensions still refuse on the press.
  tabProblem().then((key) => {
    if (key) {
      $("capture").disabled = true;
      say(t(key), true);
    }
  }, () => {});
  // Postulo's own page, in the review window: no request from here, the testing switch or not.
  $("add-listing").addEventListener("click", () => {
    openInReviewWindow(newListingUrl(settings.instance)).then(() => window.close(), (error) => say(explain(error), true));
  });
  await showCount();
  // Whatever was waiting may go now; quietly, as the background would.
  // The list of what waits in Postulo is read too, unless it was read a moment ago.
  deliverWaiting()
    .then((result) => (result.sent ? null : readWaitingList({ maxAgeMs: 60_000 })))
    .then(showCount, () => {});

  let page = null; // {url, html, source, read} of the page read this time

  $("capture").addEventListener("click", async () => {
    const button = $("capture");
    button.disabled = true;
    say(t("reading"));
    try {
      const tab = await readCurrentTab();
      const parse = (html) => new DOMParser().parseFromString(html, "text/html");
      const doc = parse(tab.html);
      const found = readPosting(doc, tab.url, parse);
      page = {
        url: tab.url,
        html: slimPage(doc),
        source: found ? found.source : "",
        read: found ? found.data : emptyPosting(tab.url),
      };
      // A page listing several postings, none of them this page: a results page. The
      // ones it lists are offered to tick, each becoming its own capture off this one
      // page (#177). A page about one posting that also lists similar ones is still that
      // posting's page, and reads as one.
      const listed = readPostings(doc, tab.url, parse);
      await log.add("read", { host: hostOf(tab.url), source: page.source || "nothing", listed: listed.length });
      if (listed.length > 1 && !listed.some((posting) => posting.here)) {
        offer(listed);
        show("pick");
        say("");
        return;
      }

      // Kept now, in one write, before the window opens: the popup closes the moment it
      // loses focus and the window may be closed undecided. A capture of this address
      // not sent yet is shown again rather than a second copy made.
      const existing = await store.unsentFor(tab.url);
      let record = existing;
      if (!record) {
        const form = postingForm();
        form.fill(page.read);
        record = await store.add({ url: page.url, html: page.html, source: page.source, read: page.read, data: form.values(page.read), state: "kept" });
      }
      await showCount();
      await openInReviewWindow(reviewPageUrl(record.id, { again: Boolean(existing), tab: { tabId: tab.tabId, windowId: tab.windowId } }));
      window.close();
    } catch (error) {
      await log.add("error", { where: "reading", problem: error.key || error.message });
      say(explain(error), true);
      button.disabled = false;
    }
  });

  /** The permission request for the click handler, or null when sending needs none.
   *  Requesting an origin already granted resolves true without a prompt. */
  function askFor() {
    if (!connected || settings.offline) {
      return null;
    }
    return () => {
      say(t("allowing"));
      return requestHostPermission(originPattern(settings.instance));
    };
  }

  // ------------------------------------------------------- several at once

  let offered = []; // what the results page listed, in its order

  /** Lay the listed postings out as a list to tick, none ticked: the gesture is
   *  "look at forty, keep three", and three is easier to tick than thirty-seven to untick. */
  function offer(listed) {
    offered = listed;
    $("pick-count").textContent = t("postingsFound", [String(listed.length)]);
    $("pick-read-by").textContent = t("readBy", [listed[0].source]);
    const list = $("pick-list");
    list.replaceChildren();
    listed.forEach((posting, index) => {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = String(index);
      const words = document.createElement("span");
      words.textContent = describe(posting.data, t("untitled"));
      const label = document.createElement("label");
      label.append(box, words);
      const item = document.createElement("li");
      item.append(label);
      list.append(item);
    });
    $("send-picked").disabled = false;
    // The ones Postulo already holds are marked, not unticked: they are unticked already,
    // and the second visit to a board's results page is where duplicates arrive in bulk.
    askKnown(settings, listed.map((posting) => posting.data)).then((answers) => {
      if (!answers) {
        return;
      }
      answers.forEach((answer, index) => {
        const label = list.children[index] && list.children[index].querySelector("label");
        if (label && (answer.listings.length || answer.captures.length)) {
          const tag = document.createElement("span");
          tag.className = "tag";
          tag.textContent = t("knownTag");
          label.append(tag);
        }
      });
    }, () => {});
  }

  function tickEvery(on) {
    for (const box of $("pick-list").querySelectorAll("input")) {
      box.checked = on;
    }
  }
  $("tick-all").addEventListener("click", () => tickEvery(true));
  $("tick-none").addEventListener("click", () => tickEvery(false));

  /** Keep the ticked postings, in the given state, as captures off the one page: those
   *  already kept and not sent are left as they are rather than kept twice. */
  async function savePicked(state) {
    const ticked = [...$("pick-list").querySelectorAll("input:checked")].map((box) => offered[Number(box.value)]);
    if (!ticked.length) {
      say(t("nothingTicked"), true);
      return [];
    }
    const entries = [];
    for (const posting of ticked) {
      if (!(await store.unsentFor(posting.data.url))) {
        entries.push({ url: posting.data.url, source: posting.source, read: posting.data, data: posting.data });
      }
    }
    const records = await store.addMany({ html: page.html, entries, state });
    await log.add(state === "waiting" ? "to send" : "kept", { batch: records.length, host: hostOf(page.url) });
    await showCount();
    return records;
  }

  $("keep-picked").addEventListener("click", async () => {
    let records;
    try {
      records = await savePicked("kept");
    } catch (error) {
      say(explain(error), true);
      return;
    }
    if (!records.length) {
      return;
    }
    $("summary").textContent = t("keptMany", [String(records.length)]);
    show("result");
    say(t("kept"));
  });

  $("send-picked").addEventListener("click", async () => {
    const button = $("send-picked");
    button.disabled = true;
    try {
      let declined = false;
      const records = await askAndKeep(askFor(), () => savePicked("waiting"), () => {
        declined = true;
      });
      if (!records.length) {
        button.disabled = false;
        return;
      }
      say(t("sending"));
      const result = await deliverWaiting(records.map((record) => record.id));
      const latest = await Promise.all(records.map((record) => store.get(record.id)));
      const sent = latest.filter((record) => record && record.state === "sent").length;
      const refused = latest.filter((record) => record && record.state === "refused").length;
      await showCount();
      $("summary").textContent = t("sentMany", [String(sent)]);
      show("result");
      if (refused) {
        say(t("refusedSome", [String(refused)]), true);
      } else if (sent === records.length) {
        say(t("captured"));
      } else if (declined) {
        say(t("permissionRefused"), true);
      } else {
        say(...afterSending(result));
      }
    } catch (error) {
      say(explain(error), true);
      button.disabled = false;
    }
  });
}

main();
