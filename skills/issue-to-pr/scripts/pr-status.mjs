#!/usr/bin/env node
// Prints the merge readiness of a PR as JSON. With --watch, polls until every
// check has finished and the AI reviewer has run on the head commit, or the timeout hits.
//
// Usage: node pr-status.mjs <pr> [--watch] [--reviewer <regex>] [--no-ai-wait] [--timeout-min 60] [--interval 30]
// --no-ai-wait: the reviewer does not re-run on push, so a missing review on the head commit does not block.
// Exit: 0 state printed, 2 watch timed out, 1 error (also in --watch when, with all checks
// finished, the reviewer pattern matches no check name and no review or comment author on the PR).
import { execFileSync } from "node:child_process";
import { unmatchedReviewer } from "./reviewer-match.mjs";

const args = process.argv.slice(2);
const pr = args.find((a) => /^\d+$/.test(a));
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const watch = args.includes("--watch");
const reviewer = new RegExp(opt("--reviewer", "claude"), "i");
const aiWait = !args.includes("--no-ai-wait");
const timeoutMs = Number(opt("--timeout-min", 60)) * 60_000;
const intervalMs = Number(opt("--interval", 30)) * 1000;

if (!pr) {
  console.error("usage: pr-status.mjs <pr> [--watch] [--reviewer <regex>] [--timeout-min N] [--interval S]");
  process.exit(1);
}

const gh = (...a) => execFileSync("gh", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const ghJson = (...a) => JSON.parse(gh(...a));

const FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

function state() {
  const repo = ghJson("repo", "view", "--json", "nameWithOwner,defaultBranchRef");
  const [owner, name] = repo.nameWithOwner.split("/");
  const defaultBranch = repo.defaultBranchRef.name;
  const p = ghJson(
    "pr", "view", pr, "--json",
    "number,url,isDraft,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,reviews,comments,commits",
  );
  const headDate = p.commits.at(-1)?.committedDate ?? "";

  const checks = { pending: [], failing: [], passed: 0 };
  const labels = [];
  let reviewerCheckDone = false;
  for (const c of p.statusCheckRollup ?? []) {
    const label = c.name ?? c.context;
    labels.push(label ?? "");
    const done = c.__typename === "CheckRun" ? c.status === "COMPLETED" : !["PENDING", "EXPECTED"].includes(c.state);
    const result = c.conclusion ?? c.state;
    if (!done) checks.pending.push(label);
    else if (FAILED.has(result)) checks.failing.push({ name: label, url: c.detailsUrl ?? c.targetUrl });
    else checks.passed++;
    if (done && reviewer.test(label ?? "")) reviewerCheckDone = true;
  }

  const items = [
    ...p.reviews
      .filter((r) => reviewer.test(r.author?.login ?? "") && r.commit?.oid === p.headRefOid)
      .map((r) => ({ kind: "review", author: r.author.login, state: r.state, body: r.body })),
    ...p.comments
      .filter((c) => reviewer.test(c.author?.login ?? "") && c.createdAt >= headDate)
      .map((c) => ({ kind: "comment", author: c.author.login, url: c.url, body: c.body })),
  ];

  const threads = ghJson(
    "api", "graphql",
    "-f", "query=query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){reviewThreads(first:100){nodes{id isResolved path line comments(first:1){nodes{author{login} body}}}}}}}",
    "-F", `o=${owner}`, "-F", `n=${name}`, "-F", `p=${pr}`,
  ).data.repository.pullRequest.reviewThreads.nodes
    .filter((t) => !t.isResolved)
    .map((t) => ({ id: t.id, path: t.path, line: t.line, author: t.comments.nodes[0]?.author?.login, body: t.comments.nodes[0]?.body }));

  const behindBy = Number(
    gh("api", `repos/${owner}/${name}/compare/${defaultBranch}...${p.headRefOid}`, "--jq", ".behind_by").trim(),
  );

  const aiReview = { done: reviewerCheckDone || items.length > 0 || !aiWait, items };
  // Branch protection that requires a human approval reports BLOCKED until someone approves.
  const awaitingApproval = p.mergeStateStatus === "BLOCKED" && p.reviewDecision === "REVIEW_REQUIRED";
  const ready =
    !p.isDraft &&
    checks.pending.length === 0 &&
    checks.failing.length === 0 &&
    aiReview.done &&
    (p.mergeStateStatus === "CLEAN" || awaitingApproval) &&
    p.baseRefName === defaultBranch &&
    behindBy === 0 &&
    threads.length === 0;

  const authors = [...p.reviews, ...p.comments].map((x) => x.author?.login ?? "");
  const unmatched = watch
    ? unmatchedReviewer({ reviewer, aiWait, pending: checks.pending, mergeStateStatus: p.mergeStateStatus, labels, authors, pr })
    : null;
  // Not enumerable, so the printed JSON stays the same.
  return Object.defineProperty({
    pr: p.number, url: p.url, head: p.headRefOid, defaultBranch, isDraft: p.isDraft,
    mergeable: p.mergeable, mergeStateStatus: p.mergeStateStatus, reviewDecision: p.reviewDecision, awaitingApproval, behindBy,
    checks, aiReview, unresolvedThreads: threads, ready,
  }, "unmatched", { value: unmatched });
}

try {
  const start = Date.now();
  let s = state();
  const failIfUnmatched = () => {
    if (s.unmatched) {
      console.error(s.unmatched);
      process.exit(1);
    }
  };
  failIfUnmatched();
  // GitHub computes mergeStateStatus lazily; UNKNOWN means "ask again".
  while (watch && (s.checks.pending.length > 0 || !s.aiReview.done || s.mergeStateStatus === "UNKNOWN")) {
    if (Date.now() - start > timeoutMs) {
      console.log(JSON.stringify({ ...s, timedOut: true }, null, 2));
      process.exit(2);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    s = state();
    failIfUnmatched();
  }
  console.log(JSON.stringify(s, null, 2));
} catch (e) {
  console.error(e.stderr?.toString() || e.message);
  process.exit(1);
}
