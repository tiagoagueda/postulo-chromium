// The window a capture is reviewed in: the form for what was read, which the popup used
// to hold. The popup reads the page and keeps the capture before opening this, so a window
// that loses focus, or is closed, loses nothing; here the person corrects it and decides.

import { askAndKeep } from "./lib/allow.js";
import { describe, originPattern, pictureRefused, sendRendering } from "./lib/api.js";
import { ext, loadSettings, requestHostPermission } from "./lib/browser.js";
import { postingForm } from "./lib/form.js";
import { explain, localise, t, useStoredLanguage } from "./lib/i18n.js";
import { askKnown, sayKnown } from "./lib/known.js";
import { afterSending, deliverWaiting, log, showUnsentCount, store } from "./lib/local.js";
import { hostOf } from "./lib/log.js";
import { drawPage, encodePicture } from "./lib/picture.js";
import { onInstance, renderingOffer } from "./lib/rendering.js";
import { openInReviewWindow } from "./lib/window.js";

const $ = (id) => document.getElementById(id);

function say(text, isError = false) {
  const status = $("status");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function show(section) {
  for (const id of ["edit", "result"]) {
    $(id).hidden = id !== section;
  }
  $("picture").hidden = true;
}

/** Close the window this page is in, when it is the review window; else say `fallback`. */
async function closeOrSay(fallback) {
  try {
    const here = ext.windows && (await ext.windows.getCurrent());
    if (here && here.type === "popup") {
      await ext.windows.remove(here.id);
      return;
    }
  } catch {
    // Said below.
  }
  show("result");
  $("summary").textContent = fallback;
  $("review").hidden = true;
  say("");
}

async function main() {
  await useStoredLanguage();
  localise();
  const settings = await loadSettings();
  const connected = Boolean(settings.instance && settings.token);
  $("not-connected").hidden = connected;
  $("offline-on").hidden = !settings.offline;
  $("open-options").addEventListener("click", () => ext.runtime.openOptionsPage());

  const query = new URLSearchParams(location.search);
  let current = await store.get(query.get("id") || "");
  if (!current) {
    // Deleted meanwhile, or never there: nothing to show.
    $("summary").textContent = t("nothingKept");
    show("result");
    return;
  }

  const editor = postingForm();
  $("form-slot").append(editor.form);

  /** The page is Postulo's own once the capture is there: shown in this same window. */
  const goToReview = (record) => {
    $("summary").textContent = describe(record.data, t("untitled"));
    // A record kept before the address was checked is checked again here (SEC2-079).
    const address = onInstance(record.reviewUrl, settings.instance);
    $("review").href = address;
    $("review").hidden = !address;
    show("result");
  };
  $("review").addEventListener("click", (event) => {
    event.preventDefault();
    openInReviewWindow($("review").href).catch((error) => say(explain(error), true));
  });

  if (current.state === "sent") {
    goToReview(current);
    return;
  }

  editor.fill(current.data);
  $("edit-hint").textContent = query.get("again") ? t("alreadyKept") : current.source ? t("reviewHint") : t("nothingRead");
  $("edit-read-by").textContent = current.source ? t("readBy", [current.source]) : "";
  // Captured before? Asked after the form is up, and said when the answer comes;
  // the form is usable meanwhile and stays usable if it never does (#178).
  askKnown(settings, [current.read || current.data]).then((answers) => sayKnown($("edit-known"), answers && answers[0], settings.instance), () => {});
  show("edit");
  editor.focus();

  // ------------------------------------------- a picture of the whole page

  /** When Postulo keeps a picture of the page beside a capture, say so and offer to send
   *  one -- the page as it is on the screen, which only the browser can draw. Only for a
   *  capture made here and now (the popup passes the tab it read, and the page must still
   *  be the one captured): a retry from the background has no page to draw, and a batch
   *  from a results page never gets here. Nothing is drawn until it is said yes to. */
  function offerPicture(record) {
    const tab = { tabId: Number(query.get("tab")), windowId: Number(query.get("window")) };
    const offer = query.has("tab") && query.has("window") && Number.isInteger(tab.tabId) && Number.isInteger(tab.windowId) ? renderingOffer(settings.instance, record.page) : null;
    if (!offer) {
      return;
    }
    const send = $("picture-send");
    send.disabled = false;
    $("picture").hidden = false;
    send.onclick = async () => {
      send.disabled = true;
      try {
        say(t("pictureDrawing"));
        const picture = await encodePicture(await drawPage({ ...tab, url: record.url }), offer.types, offer.max);
        if (!picture) {
          say(t("pictureTooBig"), true);
          return;
        }
        say(t("pictureSending"));
        await sendRendering(settings.token, offer.url, picture);
        await log.add("picture", { id: record.id, bytes: picture.size });
        $("picture").hidden = true;
        say(t("pictureSent"));
      } catch (error) {
        await log.add("error", { where: "picture", problem: error.key || error.message });
        if (pictureRefused(error)) {
          $("picture").hidden = true;
          say(t("pictureNotKept"), true);
        } else {
          say(error instanceof Error && !error.key && !error.status ? t("pictureFailed") : explain(error), true);
          send.disabled = false;
        }
      }
    };
    $("picture-skip").onclick = () => {
      $("picture").hidden = true;
      say(t("captured"));
    };
  }

  /** Keep what the form says, in the given state. */
  async function save(state) {
    const latest = await store.get(current.id);
    if (!latest) {
      throw new Error(t("nothingKept"));
    }
    const data = editor.values(latest.data);
    current = await store.update(current.id, { data, state, problem: null });
    await log.add(state === "waiting" ? "to send" : "kept", { id: current.id, host: hostOf(current.url) });
    await showUnsentCount();
    return current;
  }

  $("keep").addEventListener("click", async () => {
    if (!editor.form.reportValidity()) {
      return;
    }
    try {
      const record = await save("kept");
      $("summary").textContent = describe(record.data, t("untitled"));
      $("review").hidden = true;
      show("result");
      say(t("kept"));
    } catch (error) {
      say(explain(error), true);
    }
  });

  $("send").addEventListener("click", async () => {
    if (!editor.form.reportValidity()) {
      return;
    }
    const button = $("send");
    button.disabled = true;
    try {
      // Asked for here, from the click, while the browser still counts it as one; the
      // capture is kept in the same tick, so a refused prompt does not cost it.
      const ask =
        connected && !settings.offline
          ? () => {
              say(t("allowing"));
              return requestHostPermission(originPattern(settings.instance));
            }
          : null;
      let declined = false;
      const record = await askAndKeep(ask, () => save("waiting"), () => {
        declined = true;
      });
      say(t("sending"));
      const result = await deliverWaiting([record.id]);
      current = await store.get(record.id);
      await showUnsentCount();
      if (current.state === "sent") {
        goToReview(current);
        say(t("captured"));
        offerPicture(current);
      } else if (current.state === "refused") {
        // Postulo said no to this one: the form stays, to fix it and send again.
        say(explain(current.problem), true);
        button.disabled = false;
      } else {
        $("summary").textContent = describe(current.data, t("untitled"));
        $("review").hidden = true;
        show("result");
        if (declined) {
          say(t("permissionRefused"), true);
        } else {
          say(...afterSending(result));
        }
      }
    } catch (error) {
      say(explain(error), true);
      button.disabled = false;
    }
  });

  $("delete").addEventListener("click", async () => {
    if (!window.confirm(t("deleteConfirm"))) {
      return;
    }
    try {
      await store.remove(current.id);
      await log.add("deleted", { id: current.id, state: current.state });
      await showUnsentCount();
    } catch (error) {
      say(explain(error), true);
      return;
    }
    await closeOrSay(t("nothingKept"));
  });
}

main();
