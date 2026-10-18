// Sending the captures a person has said to send, whenever Postulo can be reached.
//
// Nothing here decides to send anything: only captures in the `waiting` state go, and a
// capture is waiting because somebody pressed Send. What this decides is when. The popup
// tries at once; the background tries again every few minutes and when the browser
// starts; the list of captures tries when it is opened. All of them come here, one at a
// time, so the same capture is never sent twice by two of them at once.

import { ADDRESS_LIMIT, Refusal, capture, kindOfFailure, problemOf } from "./api.js";
import { hostOf } from "./log.js";
import { onInstance, pageOf } from "./rendering.js";

/** One delivery at a time across the popup, the pages and the background: they share an
 *  origin, so a Web Lock held by one holds for all. Tests pass their own. */
export function exclusively(work) {
  const locks = globalThis.navigator && globalThis.navigator.locks;
  return locks ? locks.request("postulo-outbox", work) : work();
}

/** The Idempotency-Key of a record as it stands: its id, and a digest of what is sent, so
 *  that editing the record gives a new key (Postulo refuses a key reused with another
 *  payload) while a retry of the same record repeats the key. */
function keyOf(record, payload) {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(payload)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  }
  return `${record.id}-${hash.toString(16)}`;
}

/**
 * Send what is waiting, oldest first.
 *
 * Stops at the first sign Postulo cannot be reached, or will not take the token: the rest
 * would fail the same way, and trying them all against a server that is down helps nobody.
 * A capture Postulo refuses on its own account is marked refused, and the others go on. So is
 * one whose address Postulo could not take however it was asked (see `addressFits`): it is not
 * sent, and says so in a sentence of its own.
 *
 * Resolves to `{outcome, sent, problem?, status?}` (`status` being what Postulo answered with, when it did), `outcome` being one of `nothing` (none waiting),
 * `unconfigured`, `offline` (the testing switch), `noPermission`, `unreachable`, `account`
 * (the token was refused) or `done`.
 */
export async function deliver({ store, log, settings, allowed, fetchImpl = fetch, only = null, lock = exclusively }) {
  return lock(async () => {
    const waiting = (await store.list())
      .filter((record) => record.state === "waiting" && (!only || only.includes(record.id)))
      .reverse();
    if (!waiting.length) {
      return { outcome: "nothing", sent: 0 };
    }
    const stop = async (outcome, problem) => {
      await log.add("delivery", { outcome, waiting: waiting.length, ...(problem ? { problem } : {}) });
      return { outcome, sent: 0, ...(problem ? { problem } : {}) };
    };
    if (!settings.instance || !settings.token) {
      return stop("unconfigured");
    }
    if (settings.offline) {
      return stop("offline");
    }
    if (!(await allowed())) {
      return stop("noPermission");
    }

    let sent = 0;
    for (const record of waiting) {
      if (!addressFits(withoutFragment(record.url))) {
        const problem = problemOf(new Refusal("addressTooLong"));
        await log.add("failed", { id: record.id, kind: "refused", status: "not sent", problem });
        await store.update(record.id, { state: "refused", problem });
        continue;
      }
      await log.add("send", { id: record.id, host: hostOf(record.url) });
      try {
        const payload = { url: withoutFragment(record.url), html: await store.page(record.id), data: record.data, batch: record.batch };
        const result = await capture(
          settings.instance,
          settings.token,
          { ...payload, key: keyOf(record, payload) },
          fetchImpl,
        );
        await store.update(record.id, {
          state: "sent",
          sentAt: new Date().toISOString(),
          reviewUrl: onInstance(result.review_url, settings.instance),
          // What Postulo said about keeping a picture of the page, for the popup that is
          // still open on it; the background can no longer see the page to draw it.
          page: pageOf(result, record.batch),
          problem: null,
        });
        await store.dropPage(record.id);
        await log.add("sent", { id: record.id, capture: result.id });
        sent += 1;
      } catch (error) {
        const problem = problemOf(error);
        const kind = kindOfFailure(error);
        await log.add("failed", { id: record.id, kind, status: error.status || "no answer", problem });
        if (kind === "refused") {
          await store.update(record.id, { state: "refused", problem });
          continue;
        }
        await store.update(record.id, { problem });
        const outcome = kind === "account" ? "account" : "unreachable";
        await log.add("delivery", { outcome, sent, waiting: waiting.length - sent });
        return { outcome, sent, problem, status: error.status };
      }
    }
    await log.add("delivery", { outcome: "done", sent });
    return { outcome: "done", sent };
  });
}

/** The address as Postulo wants it: a fragment never identifies a posting, and can be very long. */
function withoutFragment(url) {
  const at = typeof url === "string" ? url.indexOf("#") : -1;
  return at < 0 ? url : url.slice(0, at);
}

/** Whether Postulo can be given this address at all: it requires one, and takes up to ADDRESS_LIMIT
 *  characters. One that is empty is one `tidy` left out for being too long, and no sending can
 *  make the core accept either, so the capture is stopped here instead of being refused there. */
function addressFits(address) {
  return typeof address === "string" && address.length > 0 && address.length <= ADDRESS_LIMIT;
}
