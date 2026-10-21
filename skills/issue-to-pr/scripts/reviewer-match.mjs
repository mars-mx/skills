// Returns an error message when the --watch reviewer pattern can never match on
// this PR, or null. All checks must have finished, so a late reviewer check still counts.
export function unmatchedReviewer({ reviewer, aiWait, pending, mergeStateStatus, labels, authors, pr }) {
  if (!aiWait || pending.length > 0 || mergeStateStatus === "UNKNOWN") return null;
  // Right after `gh pr create` the rollup can be empty for a few seconds.
  if (labels.length === 0) return null;
  if (labels.some((l) => reviewer.test(l)) || authors.some((a) => reviewer.test(a))) return null;
  return `reviewer pattern /${reviewer.source}/i matches no check or author on PR ${pr}; checks: ${labels.join(", ")}; authors: ${[...new Set(authors)].join(", ")}`;
}
