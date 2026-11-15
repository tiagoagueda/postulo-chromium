// Runs with `node --test`: the token and the kept pages are not readable from the scripts
// the extension injects into a web page (SEC3-013).
import assert from "node:assert/strict";
import { test } from "node:test";

const asked = [];
globalThis.chrome = {
  storage: {
    local: {
      setAccessLevel: async (options) => {
        asked.push(options);
      },
    },
  },
};

test("storage.local is narrowed to the extension's trusted contexts as soon as the extension's code loads", async () => {
  await import("../src/lib/local.js");
  assert.deepEqual(asked, [{ accessLevel: "TRUSTED_CONTEXTS" }]);
});
