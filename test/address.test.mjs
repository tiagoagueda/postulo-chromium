// Runs with `node --test`: the address rule, against what the core's same_url() answers.
import assert from "node:assert/strict";
import { test } from "node:test";

import { sameUrl } from "../src/lib/address.js";

// The first four are the core's own (tests/test_known.py). The rest were put to
// postulo.core.addresses.same_url with Python 3.14 and the answers copied here, so that a
// difference between this copy and the core's rule is noticed instead of drifting: an
// upper-case "WWW.", a port, a user name, ";parameters", "..", a space and a non-ASCII
// character all stay part of the key in the core, and so they do here.
const CORE = [
  ["https://www.example.org/jobs/42/", "example.org/jobs/42"],
  ["http://example.org/jobs/42", "example.org/jobs/42"],
  ["HTTPS://EXAMPLE.ORG/JOBS/42/", "example.org/jobs/42"],
  ["https://board.example/view?id=7", "board.example/view?id=7"],
  ["", ""],
  ["not a url", ""],
  ["https://WWW.Example.org/a", "www.example.org/a"],
  ["https://example.org:443/a", "example.org:443/a"],
  ["http://example.org:80/a/", "example.org:80/a"],
  ["https://user@example.org/a", "user@example.org/a"],
  ["https://example.org/a;x=1", "example.org/a"],
  ["https://example.org/a;x=1/b", "example.org/a;x=1/b"],
  ["https://example.org/a/../b", "example.org/a/../b"],
  ["https://example.org/a b", "example.org/a b"],
  ["https://exämple.org/ä", "exämple.org/ä"],
  ["https://example.org/a?", "example.org/a"],
  ["https://example.org/a#frag", "example.org/a"],
  ["https://example.org/a?x=1#f", "example.org/a?x=1"],
  ["//example.org/a/", "example.org/a"],
  ["example.org/a", ""],
  ["localhost:8080/x", ""],
  ["https://[::1/a", ""],
  ["  https://example.org/a\n", "example.org/a"],
  ["https://example.org", "example.org"],
  ["https://example.org///", "example.org"],
  ["https://www.", ""],
  ["javascript:alert(1)", ""],
  ["https://example.org/a;p?q=1;z", "example.org/a?q=1;z"],
  ["https://example.org/a/b;p/", "example.org/a/b;p"],
  ["HtTp://www.example.org/A?B=C", "example.org/a?b=c"],
  ["https:///a", ""],
  ["mailto:a@b.c", ""],
  ["https://example.org/?id=3", "example.org?id=3"],
  ["https://example.org/a;b;c", "example.org/a"],
  ["https://ex.org/x\ty", "ex.org/xy"],
];

test("the address rule answers as the core does", () => {
  for (const [raw, expected] of CORE) {
    assert.equal(sameUrl(raw), expected, JSON.stringify(raw));
  }
});

test("nothing that is not a web address is a key", () => {
  assert.equal(sameUrl(undefined), "");
  assert.equal(sameUrl(null), "");
});
