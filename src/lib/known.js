// "Captured before?": what Postulo already holds for a posting, asked and said by the
// popup (a results page) and by the review window (one capture) alike (#178).

import { known, originPattern } from "./api.js";
import { hasHostPermission } from "./browser.js";
import { t } from "./i18n.js";
import { onInstance } from "./rendering.js";
import { learnFromCall, log } from "./local.js";

/** What Postulo already holds for these postings, or null when it cannot be asked --
 *  not set up, the testing switch on, no permission yet, unreachable, or a Postulo
 *  older than the question -- in which case the capture proceeds exactly as it would
 *  have (#178). Never a permission prompt: that waits for a press of Send. */
export async function askKnown(settings, postings) {
  if (!settings.instance || !settings.token || settings.offline || !postings.length) {
    return null;
  }
  try {
    if (!(await hasHostPermission(originPattern(settings.instance)))) {
      return null;
    }
    const answers = await known(settings.instance, settings.token, postings);
    // Keeping what was learnt must not turn an answer into a failure.
    await learnFromCall("known").catch(() => {});
    return answers;
  } catch (error) {
    await log.add("known", { problem: error.key || error.message });
    await learnFromCall("known", error).catch(() => {});
    return null;
  }
}

/** Say, in `element`, what one answer holds -- the address first, then the softer
 *  match on title and company -- with a link to it in Postulo; or nothing at all. */
export function sayKnown(element, answer, instance = "") {
  // In the language of the catalogue in use, like every other date here. With no locale
  // named the browser's setting decides, and in a language nobody has translated that put
  // a date in one language inside a sentence in another.
  const when = (iso) => new Date(iso).toLocaleDateString(t("languageTag"));
  const first = (key) => (answer && Array.isArray(answer[key]) ? answer[key][0] : undefined);
  const listing = first("listings");
  const waiting = first("captures");
  const similar = first("similar");
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
  // The link only where it is on the instance's own origin (SEC2-079); the sentence stands without.
  const address = onInstance(link, instance);
  if (!address) {
    element.append(sentence);
    element.hidden = false;
    return;
  }
  element.append(`${sentence} `);
  const open = document.createElement("a");
  open.href = address;
  open.target = "_blank";
  open.rel = "noopener";
  open.textContent = t("knownOpen");
  element.append(open);
  element.hidden = false;
}
