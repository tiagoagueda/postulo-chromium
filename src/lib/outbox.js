// Sending the captures a person has said to send, whenever Postulo can be reached.
//
// Nothing here decides to send anything: only captures in the `waiting` state go, and a
// capture is waiting because somebody pressed Send. What this decides is when. The popup
// tries at once; the background tries again every few minutes and when the browser
// starts; the list of captures tries when it is opened. All of them come here, one at a
// time, so the same capture is never sent twice by two of them at once.

import { capture, kindOfFailure, problemOf } from "./api.js";
import { hostOf } from "./log.js";

/** One delivery at a time across the popup, the pages and the background: they share an
 *  origin, so a Web Lock held by one holds for all. Tests pass their own. */
export function exclusively(work) {
  const locks = globalThis.navigator && globalThis.navigator.locks;
  return locks ? locks.request("postulo-outbox", work) : work();
}

/**
 * Send what is waiting, oldest first.
 *
 * Stops at the first sign Postulo cannot be reached, or will not take the token: the rest
 * would fail the same way, and trying them all against a server that is down helps nobody.
 * A capture Postulo refuses on its own account is marked refused, and the others go on.
 *
 * Resolves to `{outcome, sent, problem?}`, `outcome` being one of `nothing` (none waiting),
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
      await log.add("send", { id: record.id, host: hostOf(record.url) });
      try {
        const result = await capture(
          settings.instance,
          settings.token,
          { url: record.url, html: await store.page(record.id), data: record.data },
          fetchImpl,
        );
        await store.update(record.id, {
          state: "sent",
          sentAt: new Date().toISOString(),
          reviewUrl: result.review_url,
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
        return { outcome, sent, problem };
      }
    }
    await log.add("delivery", { outcome: "done", sent });
    return { outcome: "done", sent };
  });
}
