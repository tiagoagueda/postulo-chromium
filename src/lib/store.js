// Captures kept in this browser, until they reach Postulo and after.
//
// Each capture is its own record, and the page it was read from is kept apart from it, so
// that listing captures never loads every page. An index of ids, newest first, is the one
// value two places could both change, and it changes only when a capture is added or
// deleted: things a person does, one at a time. Delivery touches records and pages only.
//
// A capture is in one of four states:
//   kept     in this browser, not to be sent until the person says so
//   waiting  the person said send; it goes as soon as Postulo can be reached
//   sent     Postulo has it, waiting for review there; `reviewUrl` says where
//   refused  Postulo would not take it, and `problem` says why; the person can fix and resend

const INDEX = "captures";
const RECORD = (id) => `capture:${id}`;
const PAGE = (id) => `page:${id}`;

export const UNSENT = new Set(["kept", "waiting", "refused"]);

/** Whether a stored key belongs to the captures, for listeners to storage changes. */
export function isCaptureKey(key) {
  return key === INDEX || key.startsWith("capture:");
}

/** The store over a storage area: `storage.local` in the extension, a stand-in in tests. */
export function makeStore(area, { now = () => new Date().toISOString(), newId = () => crypto.randomUUID() } = {}) {
  const ids = async () => (await area.get(INDEX))[INDEX] || [];

  const store = {
    /** Every capture, newest first. */
    async list() {
      const all = await ids();
      if (!all.length) {
        return [];
      }
      const found = await area.get(all.map(RECORD));
      return all.map((id) => found[RECORD(id)]).filter(Boolean);
    },

    async get(id) {
      return (await area.get(RECORD(id)))[RECORD(id)] || null;
    },

    /** The page a capture was read from, as it is sent: gone once Postulo has it. */
    async page(id) {
      return (await area.get(PAGE(id)))[PAGE(id)] || "";
    },

    /** Keep a new capture. */
    async add({ url, html, source, read, data, state = "kept" }) {
      const id = newId();
      const at = now();
      const record = { id, url, source, read, data, state, capturedAt: at, updatedAt: at };
      // One write for all three: a popup closes the moment it loses focus, and a capture
      // written without its place in the index would be kept and never listed.
      const index = [id, ...(await ids())];
      await area.set({ [RECORD(id)]: record, [PAGE(id)]: html, [INDEX]: index });
      return record;
    },

    /** Change a capture; null if it has been deleted meanwhile. */
    async update(id, patch) {
      const record = await store.get(id);
      if (!record) {
        return null;
      }
      const next = { ...record, ...patch, updatedAt: now() };
      await area.set({ [RECORD(id)]: next });
      return next;
    },

    /** Postulo has the page now: the browser need not keep it. */
    async dropPage(id) {
      await area.remove(PAGE(id));
    },

    async remove(id) {
      await area.remove([RECORD(id), PAGE(id)]);
      await area.set({ [INDEX]: (await ids()).filter((other) => other !== id) });
    },

    /** A capture of this address that has not reached Postulo, if there is one. */
    async unsentFor(url) {
      return (await store.list()).find((record) => record.url === url && UNSENT.has(record.state)) || null;
    },

    async unsentCount() {
      return (await store.list()).filter((record) => UNSENT.has(record.state)).length;
    },
  };
  return store;
}
