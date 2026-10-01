import { expect, test } from "vitest";
import type { NextResult } from "../server/core/commands";
import { afterClose, afterCloseCheck, afterNext, nextPrompt } from "../server/core/text";

// The copy pinned here is fixed by spec sections 6 and 8.

const result: NextResult = {
  epic: "E100",
  epicBranch: "epic/E100-sidera",
  closed: {
    story: "TH-666",
    pr: {
      number: 276,
      url: "https://github.com/o/r/pull/276",
      headRefName: "feat/TH-666-streaming",
      mergedAt: "2026-10-01T09:00:00Z",
      title: "TH-666: Streaming",
    },
    comments: [{ author: "someone", createdAt: "2026-10-01T08:30:00Z", body: "Q3: use the mirror rule." }],
  },
  next: {
    story: "TH-667",
    title: "Procedure reads",
    lane: "high-risk",
    branch: "feat/TH-667-procedure-reads",
    baseRef: "origin/epic/E100-sidera",
  },
};

test("afterClose names the PR and the wait for the merge", () => {
  const text = afterClose("https://x/pull/274", []);
  expect(text).toContain("https://x/pull/274");
  expect(text).toContain("merge it, then reply `next`");
  expect(text).toContain("Do not build the next story here");
});

test("afterCloseCheck with problems names the ledger bullets and the handoff headings", () => {
  const text = afterCloseCheck(["p"]);
  expect(text).toContain("call epic_close_check again");
  for (const bullet of ["Branch / PR", "Shipped", "Decisions", "Deviations", "Effects on later stories"]) {
    expect(text).toContain(bullet);
  }
  expect(text).toContain("headings 1 to 5");
});

test("afterNext names the started agent and the plan stop", () => {
  const text = afterNext(result, { title: "TH-667 Procedure reads" });
  expect(text).toContain("TH-667 Procedure reads");
  expect(text).toContain("stop for plan approval");
});

test("afterNext with no agent names the branch to start by hand", () => {
  const text = afterNext(result, null);
  expect(text.startsWith("TH-667 Procedure reads is next; the successor is not started yet.")).toBe(true);
  expect(text).toContain("feat/TH-667-procedure-reads");
  expect(text).toContain("`/epic start TH-667`");
});

test("afterNext pending tells the agent to wait for the successor's name", () => {
  const text = afterNext(result, "pending");
  expect(text).toBe(
    "TH-667 Procedure reads is next. The plugin is starting the successor now; " +
      "wait for its name, then this session is finished.",
  );
  const noGh = afterNext({ ...result, closed: { ...result.closed, pr: null } }, "pending");
  expect(noGh).toContain("`gh` was not available");
  expect(noGh).not.toContain("/epic start");
});

test("nextPrompt carries the start line, the PR answers and the extra line", () => {
  const text = nextPrompt(result, "extra");
  expect(text.startsWith("/epic start TH-667")).toBe(true);
  expect(text).toContain("Answers from PR #276 (conversation comments, oldest first):");
  expect(text).toContain("Q3: use the mirror rule.");
  expect(text.endsWith("extra")).toBe(true);
});

test("nextPrompt with no comments says none", () => {
  const text = nextPrompt({ ...result, closed: { ...result.closed, comments: [] } });
  expect(text).toContain("Answers from PR #276 (conversation comments, oldest first):\nnone");
});
