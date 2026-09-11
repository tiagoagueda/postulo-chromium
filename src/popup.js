import { describe, originPattern } from "./lib/api.js";
import { ext, hasHostPermission, loadSettings, readCurrentTab, requestHostPermission } from "./lib/browser.js";
import { postingForm } from "./lib/form.js";
import { explain, localise, t } from "./lib/i18n.js";
import { afterSending, deliverWaiting, log, openCaptures, showUnsentCount, store } from "./lib/local.js";
import { hostOf } from "./lib/log.js";
import { emptyPosting, readPosting, slimPage } from "./lib/parse.js";

const $ = (id) => document.getElementById(id);

function show(section) {
  for (const id of ["ready", "edit", "result"]) {
    $(id).hidden = id !== section;
  }
  // The form needs more room than a button does.
  document.body.classList.toggle("wide", section === "edit");
  // And all the height a popup gets: the link to the list waits until it is done.
  $("captures-link").parentElement.hidden = section === "edit";
  // The notes about the connection too: what became of a capture is said once it is sent.
  for (const id of ["not-connected", "offline-on"]) {
    $(id).classList.toggle("folded", section === "edit");
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
      await log.add("read", { host: hostOf(tab.url), source: page.source || "nothing" });

      // Already kept and not sent: show that one, edits and all, rather than a second copy.
      current = await store.unsentFor(tab.url);
      editor.fill(current ? current.data : page.read);
      $("edit-hint").textContent = current ? t("alreadyKept") : found ? t("reviewHint") : t("nothingRead");
      const source = current ? current.source : page.source;
      $("edit-read-by").textContent = source ? t("readBy", [source]) : "";
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
}

main();
