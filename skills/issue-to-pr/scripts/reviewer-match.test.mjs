import { test } from "node:test";
import assert from "node:assert/strict";
import { unmatchedReviewer } from "./reviewer-match.mjs";

const base = { aiWait: true, pending: [], mergeStateStatus: "BLOCKED", labels: ["build", "claude-review"], authors: ["mars", "claude"], pr: "1273" };

test("pattern matches a check name: no error", () => {
  assert.equal(unmatchedReviewer({ ...base, reviewer: /claude-review/i, authors: ["mars"] }), null);
});

test("pattern matches an author login: no error", () => {
  assert.equal(unmatchedReviewer({ ...base, reviewer: /^claude$/i, labels: ["build"] }), null);
});

test("pattern matches neither once all checks are done: error", () => {
  assert.equal(
    unmatchedReviewer({ ...base, reviewer: /Claude Code Review/i }),
    "reviewer pattern /Claude Code Review/i matches no check or author on PR 1273; checks: build, claude-review; authors: mars, claude",
  );
});

test("checks still pending: no error yet", () => {
  assert.equal(unmatchedReviewer({ ...base, reviewer: /Claude Code Review/i, pending: ["build"] }), null);
});
