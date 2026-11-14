// Which Postulo the extension talks to: changing it, and leaving it (SEC3-015).
//
// What waited for one Postulo is not sent to another without a further press of Send, and
// the extension can be made to forget its Postulo altogether.

import { CONNECTION } from "./connection.js";
import { WAITING } from "./waiting.js";

/** The origin of an address, or "" for none (or for one that is not an address). */
export function originOf(address) {
  try {
    return address ? new URL(address).origin : "";
  } catch {
    return "";
  }
}

/** Put every capture that was waiting to be sent back to kept; how many there were. */
async function keepWaiting(store) {
  let released = 0;
  for (const record of await store.list()) {
    if (record.state === "waiting") {
      await store.update(record.id, { state: "kept" });
      released += 1;
    }
  }
  return released;
}

/** Save the address and the token. When the address is another origin than the one saved,
 *  what waited for the old one goes back to kept *before* the new address is stored, since
 *  storing it is what wakes the delivery. A renewed token on the same address changes
 *  nothing about what waits. Returns how many captures were put back. */
export async function saveConnection({ area, store, next }) {
  const stored = await area.get(["instance"]);
  const before = originOf(stored.instance);
  const released = before && before !== originOf(next.instance) ? await keepWaiting(store) : 0;
  await area.set({ instance: next.instance, token: next.token });
  return released;
}

/** Forget this Postulo: its address, the token, what was learnt of the connection and the
 *  list read from it. The captures stay, and those that waited to be sent are kept again.
 *  Returns the origin that was forgotten, so its host permission can be given back. */
export async function forgetPostulo({ area, store }) {
  const stored = await area.get(["instance"]);
  await keepWaiting(store);
  await area.remove(["instance", "token", CONNECTION, WAITING]);
  return originOf(stored.instance);
}
