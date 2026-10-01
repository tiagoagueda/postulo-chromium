import { describe, known, originPattern } from "./lib/api.js";
import { ext, hasHostPermission, loadSettings, readCurrentTab, requestHostPermission } from "./lib/browser.js";
import { postingForm } from "./lib/form.js";
import { explain, localise, t } from "./lib/i18n.js";
import { afterSending, deliverWaiting, log, openCaptures, showUnsentCount, store } from "./lib/local.js";
import { hostOf } from "./lib/log.js";
import { emptyPosting, readPosting, readPostings, slimPage } from "./lib/parse.js";

const $ = (id) => document.getElementById(id);

function show(section) {
  for (const id of ["ready", "edit", "pick", "result"]) {
    $(id).hidden = id !== section;
  }
  const working = section === "edit" || section === "pick";
  // The form needs more room than a button does, and so does a list.
  document.body.classList.toggle("wide", working);
  // And all the height a popup gets: the link to the list waits until it is done.
  $("captures-link").parentElement.hidden = working;
  // The notes about the connection too: what became of a capture is said once it is sent.
  for (const id of ["not-connected", "offline-on"]) {
    $(id).classList.toggle("folded", working);
  }
}

function say(text, isError = false) {
  const status = $("status");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

async function showCount() {
  const count = await store.unsentCount();
  $("unsent").textContent = String(count);
  $("unsent").hidden = !count;
  await showUnsentCount();
}

async function main() {
  localise();
  const settings = await loadSettings();
  const connected = Boolean(settings.instance && settings.token);
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
  }
  show("ready");
  await showCount();
  // Whatever was waiting may go now; quietly, as the background would.
  deliverWaiting().then(showCount, () => {});

  const editor = postingForm();
  $("form-slot").append(editor.form);
  let page = null; // {url, html, source, read} of the page read this time
  let current = null; // the capture's record, once it is kept

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

      // Already kept and not sent: show that one, edits and all, rather than a second copy.
      current = await store.unsentFor(tab.url);
      editor.fill(current ? current.data : page.read);
      $("edit-hint").textContent = current ? t("alreadyKept") : found ? t("reviewHint") : t("nothingRead");
      const source = current ? current.source : page.source;
      $("edit-read-by").textContent = source ? t("readBy", [source]) : "";
      // Captured before? Asked after the form is up, and said when the answer comes;
      // the form is usable meanwhile and stays usable if it never does (#178).
      $("edit-known").hidden = true;
      askKnown([page.read]).then((answers) => sayKnown($("edit-known"), answers && answers[0]), () => {});
      show("edit");
      say("");
      editor.focus();
    } catch (error) {
      await log.add("error", { where: "reading", problem: error.key || error.message });
      say(explain(error), true);
      button.disabled = false;
    }
  });

  /** Keep what the form says, in the given state; the page as read goes with a new one. */
  async function save(state) {
    const data = editor.values(current ? current.data : page.read);
    if (current) {
      current = await store.update(current.id, { data, state, problem: null });
    }
    if (!current) {
      current = await store.add({ url: page.url, html: page.html, source: page.source, read: page.read, data, state });
    }
    await log.add(state === "waiting" ? "to send" : "kept", { id: current.id, host: hostOf(current.url) });
    await showCount();
    return current;
  }

  $("keep").addEventListener("click", async () => {
    if (!editor.form.reportValidity()) {
      return;
    }
    const record = await save("kept");
    $("summary").textContent = describe(record.data, t("untitled"));
    show("result");
    say(t("kept"));
  });

  $("send").addEventListener("click", async () => {
    if (!editor.form.reportValidity()) {
      return;
    }
    const button = $("send");
    button.disabled = true;
    try {
      // Asked for here, from the click, while the browser still counts it as one.
      if (connected && !settings.offline) {
        const pattern = originPattern(settings.instance);
        if (!(await hasHostPermission(pattern))) {
          say(t("allowing"));
          await requestHostPermission(pattern);
        }
      }
      const record = await save("waiting");
      say(t("sending"));
      const result = await deliverWaiting([record.id]);
      current = await store.get(record.id);
      await showCount();
      $("summary").textContent = describe(current.data, t("untitled"));
      if (current.state === "sent") {
        $("review").href = current.reviewUrl;
        $("review").hidden = false;
        show("result");
        say(t("captured"));
      } else if (current.state === "refused") {
        // Postulo said no to this one: the form stays, to fix it and send again.
        say(explain(current.problem), true);
        button.disabled = false;
      } else {
        show("result");
        say(...afterSending(result));
      }
    } catch (error) {
      say(explain(error), true);
      button.disabled = false;
    }
  });

  // -------------------------------------------------------- captured before

  /** What Postulo already holds for these postings, or null when it cannot be asked --
   *  not set up, the testing switch on, no permission yet, unreachable, or a Postulo
   *  older than the question -- in which case the capture proceeds exactly as it would
   *  have (#178). Never a permission prompt: that waits for a press of Send. */
  async function askKnown(postings) {
    if (!connected || settings.offline || !postings.length) {
      return null;
    }
    try {
      if (!(await hasHostPermission(originPattern(settings.instance)))) {
        return null;
      }
      return await known(settings.instance, settings.token, postings);
    } catch (error) {
      await log.add("known", { problem: error.key || error.message });
      return null;
    }
  }

  // In the language of the catalogue in use, like every other date here. With no locale
  // named the browser's setting decides, and in a language nobody has translated that put
  // a date in one language inside a sentence in another.
  const when = (iso) => new Date(iso).toLocaleDateString(t("languageTag"));

  /** Say, in `element`, what one answer holds -- the address first, then the softer
   *  match on title and company -- with a link to it in Postulo; or nothing at all. */
  function sayKnown(element, answer) {
    const listing = answer && answer.listings[0];
    const waiting = answer && answer.captures[0];
    const similar = answer && answer.similar[0];
    let sentence = "";
    let link = "";
    if (listing) {
      sentence = t("knownListing", [when(listing.created_at), listing.title]);
      link = listing.listing_url;
    } else if (waiting) {
      sentence = t("knownCapture", [when(waiting.created_at)]);
      link = waiting.review_url;
    } else if (similar) {
      sentence = t("knownSimilar", [similar.title]);
      link = similar.listing_url;
    }
    element.replaceChildren();
    if (!sentence) {
      element.hidden = true;
      return;
    }
    element.append(`${sentence} `);
    const open = document.createElement("a");
    open.href = link;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = t("knownOpen");
    element.append(open);
    element.hidden = false;
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
    askKnown(listed.map((posting) => posting.data)).then((answers) => {
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
    const records = await savePicked("kept");
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
      if (connected && !settings.offline) {
        const pattern = originPattern(settings.instance);
        if (!(await hasHostPermission(pattern))) {
          say(t("allowing"));
          await requestHostPermission(pattern);
        }
      }
      const records = await savePicked("waiting");
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
      $("review").hidden = true;
      show("result");
      if (refused) {
        say(t("refusedSome", [String(refused)]), true);
      } else if (sent === records.length) {
        say(t("captured"));
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
