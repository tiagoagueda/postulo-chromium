// The window the person reviews in: one, brought forward each time something is to be
// reviewed, so the form for a capture, Postulo's own review page and its page for adding a
// listing all appear in the same place. Where a browser has no windows (Firefox for
// Android) a tab opens instead, with no window to remember.
//
// A popup closes the moment it loses focus, so what is reviewed lives here and not there.

import { ext } from "./browser.js";

const REMEMBERED = "reviewWindow";

/** Size of the window: wide enough for the form's pairs, and for Postulo's page. */
export const WINDOW = { width: 760, height: 780 };

/** The extension's page for one capture. `again` says the capture was kept before and
 *  this was only found again, which the page tells the person; `tab` is `{tabId, windowId}`
 *  of the page it was read from, for the picture offered after Send. */
export function reviewPageUrl(id, { again = false, tab = null, api = ext } = {}) {
  const query = new URLSearchParams({ id });
  if (again) {
    query.set("again", "1");
  }
  if (tab && Number.isInteger(tab.tabId) && Number.isInteger(tab.windowId)) {
    query.set("tab", String(tab.tabId));
    query.set("window", String(tab.windowId));
  }
  return `${api.runtime.getURL("review.html")}?${query}`;
}

/** Show `url` in the review window, opening it if it is not open. `api` is the browser's,
 *  for tests. Needs no permission: `windows.create` and `tabs.update` do not. */
export async function openInReviewWindow(url, api = ext) {
  if (!api.windows || !api.windows.create) {
    await api.tabs.create({ url });
    return;
  }
  // Session storage is emptied when the browser closes, which is when a window id stops
  // meaning anything; where there is none the id is checked below.
  const area = api.storage.session || api.storage.local;
  let known;
  try {
    known = (await area.get(REMEMBERED))[REMEMBERED];
  } catch {
    known = undefined;
  }
  if (known !== undefined) {
    try {
      const open = await api.windows.get(known, { populate: true });
      // An id can outlive its window and be given to another; only a popup is ours.
      const tab = open.type === "popup" && ((open.tabs || []).find((candidate) => candidate.active) || (open.tabs || [])[0]);
      if (tab) {
        await api.tabs.update(tab.id, { url, active: true });
        await api.windows.update(open.id, open.state === "minimized" ? { focused: true, state: "normal" } : { focused: true });
        return;
      }
    } catch {
      // Closed since: a new one.
    }
  }
  const made = await api.windows.create({ url, type: "popup", ...WINDOW });
  try {
    await area.set({ [REMEMBERED]: made.id });
  } catch {
    // Not remembered: the next one opens another window, which is all.
  }
}
