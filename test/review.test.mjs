// Runs with `node --test`: the popup's list of captures that need review.
import assert from "node:assert/strict";
import { test } from "node:test";

import { MOST_ROWS, reviewRows } from "../src/lib/review.js";

const post = (id, url, at) => ({ id, url, title: `T${id}`, company_name: "Black Mesa", location: "Lyon", created_at: at, review_url: `https://p.example/r/${id}` });
const here = (id, url, capturedAt, state = "kept") => ({ id, url, state, capturedAt, data: { title: `H${id}`, company_name: "Aperture", location: "" } });

test("three captures in Postulo, two of one posting, and one posting kept here: three rows", () => {
  const waiting = [
    post(1, "https://jobs.example/a/1", "2026-10-01T09:00:00Z"),
    post(2, "https://jobs.example/a/1", "2026-10-02T09:00:00Z"),
    post(3, "https://jobs.example/a/2", "2026-10-01T12:00:00Z"),
  ];
  const { rows, total } = reviewRows(waiting, [here("x", "https://jobs.example/b/9", "2026-10-03T09:00:00Z")]);
  assert.equal(total, 3);
  assert.deepEqual(rows.map((row) => row.id), ["x", 2, 3]);
  assert.equal(rows[1].count, 2);
  assert.equal(rows[1].link, "https://p.example/r/2");
  assert.equal(rows[0].kind, "here");
  assert.equal(rows[0].state, "kept");
});

test("a posting in Postulo and kept here is one row, standing for the one in Postulo", () => {
  const { rows } = reviewRows(
    [post(1, "https://jobs.example/a/1", "2026-10-01T09:00:00Z")],
    [here("x", "https://jobs.example/a/1", "2026-10-05T09:00:00Z", "waiting")],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "postulo");
  assert.equal(rows[0].count, 2);
});

test("the newest of the captures here stands for a posting not in Postulo", () => {
  const { rows } = reviewRows([], [
    here("old", "https://jobs.example/a/1", "2026-10-01T09:00:00Z"),
    here("new", "https://jobs.example/a/1", "2026-10-02T09:00:00Z", "refused"),
  ]);
  assert.deepEqual(rows.map((row) => [row.id, row.count, row.state]), [["new", 2, "refused"]]);
});

test("a capture sent from here is not a row of its own: Postulo's list holds it", () => {
  const { rows, total } = reviewRows([], [here("s", "https://jobs.example/a/1", "2026-10-01T09:00:00Z", "sent")]);
  assert.equal(total, 0);
  assert.deepEqual(rows, []);
});

test("captures whose address names no host are one row each", () => {
  const { total } = reviewRows([post(1, "", "2026-10-01T09:00:00Z"), post(2, "", "2026-10-01T09:00:00Z")], []);
  assert.equal(total, 2);
});

test("the list stops at the limit and says how many postings there are", () => {
  const waiting = Array.from({ length: 8 }, (_, i) => post(i, `https://jobs.example/p/${i}`, `2026-10-0${i + 1}T09:00:00Z`));
  const { rows, total } = reviewRows(waiting, []);
  assert.equal(rows.length, MOST_ROWS);
  assert.equal(total, 8);
  assert.equal(rows[0].id, 7);
  assert.equal(reviewRows(waiting, [], 2).rows.length, 2);
});
