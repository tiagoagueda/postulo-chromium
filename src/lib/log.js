// What the extension did, for finding out why something did not work.
//
// Kept in the browser, the most recent entries only, and downloaded from the settings by
// the person when they want to show somebody. It records events and outcomes: a page's
// host, a capture's id, what Postulo answered. Never the token, and never a page or what
// was read from it: a log is the kind of file that gets attached to an issue.

const KEY = "log";
const LIMIT = 1000;

export function makeLog(area, { now = () => new Date().toISOString() } = {}) {
  const log = {
    /** Record an event. Never throws: a log that fails must not take the capture with it. */
    async add(event, details = {}) {
      await log.addMany([{ at: now(), event, ...details }]);
    },

    /** Record several entries, each already stamped, in one read and one write of the log.
     *  Never throws, as `add`. */
    async addMany(fresh) {
      if (!fresh.length) {
        return;
      }
      try {
        const entries = (await area.get(KEY))[KEY] || [];
        entries.push(...fresh);
        await area.set({ [KEY]: entries.slice(-LIMIT) });
      } catch {
        // Nothing to do: the log is a convenience.
      }
    },

    /** Entries noted in memory, each stamped when it happened, and written in one go by
     *  `flush` -- for a delivery, which notes about three per capture and would otherwise
     *  rewrite the whole log each time (#54). */
    batch() {
      const pending = [];
      return {
        add(event, details = {}) {
          pending.push({ at: now(), event, ...details });
        },
        flush() {
          return log.addMany(pending.splice(0));
        },
      };
    },

    async entries() {
      return (await area.get(KEY))[KEY] || [];
    },

    async clear() {
      await area.remove(KEY);
    },

    /** The log as a file: what is running, then one line per entry, oldest first. */
    async text(about = {}) {
      const lines = [
        "Postulo browser extension: log",
        ...Object.entries(about).map(([name, value]) => `${name}: ${value}`),
        "",
      ];
      for (const entry of await log.entries()) {
        const { at, event, ...details } = entry;
        const rest = Object.entries(details)
          .map(([name, value]) => `${name}=${typeof value === "string" ? value : JSON.stringify(value)}`)
          .join(" ");
        lines.push(`${at} ${event}${rest ? ` ${rest}` : ""}`);
      }
      return `${lines.join("\n")}\n`;
    },
  };
  return log;
}

/** A host for the log, never a whole address: a path can say more than a person meant to. */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
