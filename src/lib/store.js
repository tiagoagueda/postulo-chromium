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
  const pageIdOf = async (id) => {
    const record = (await area.get(RECORD(id)))[RECORD(id)];
    return (record && record.pageId) || id;
  };

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

    /** The page a capture was read from, as it is sent: gone once Postulo has it.
     *
     *  Several captures read from one page share it (#177): it is kept once, under the
     *  first of them, and each record says which in `pageId`. A record without one is a
     *  capture from before that, whose page is under its own id. */
    async page(id) {
      const key = PAGE(await pageIdOf(id));
      return (await area.get(key))[key] || "";
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

    /** Keep several captures read from one page, as one write: the page once, and each
     *  capture saying which page it came from and where it stands among the others, so
     *  Postulo can be told they came together and say so once (#177). Indexed newest
     *  first like everything else, the last of the batch counting as the newest, so that
     *  delivery -- oldest first -- sends them in the page's order and the first of the
     *  batch is the first to arrive. */
    async addMany({ html, entries, state = "kept" }) {
      if (!entries.length) {
        return [];
      }
      const at = now();
      const fresh = entries.map(() => newId());
      const pageId = fresh[0];
      const records = entries.map((entry, position) => ({
        id: fresh[position],
        url: entry.url,
        source: entry.source,
        read: entry.read,
        data: entry.data,
        state,
        capturedAt: at,
        updatedAt: at,
        pageId,
        batch: { id: pageId, size: entries.length, position: position + 1 },
      }));
      const items = { [PAGE(pageId)]: html, [INDEX]: [...fresh].reverse().concat(await ids()) };
      for (const record of records) {
        items[RECORD(record.id)] = record;
      }
      await area.set(items);
      return records;
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

    /** Postulo has the page now: the browser need not keep it -- unless another capture
     *  read from the same page has still to go, in which case it stays for that one. */
    async dropPage(id) {
      const pageId = await pageIdOf(id);
      const stillNeeded = (await store.list()).some(
        (other) => other.id !== id && (other.pageId || other.id) === pageId && UNSENT.has(other.state),
      );
      if (!stillNeeded) {
        await area.remove(PAGE(pageId));
      }
    },

    async remove(id) {
      await store.dropPage(id);
      await area.remove(RECORD(id));
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
