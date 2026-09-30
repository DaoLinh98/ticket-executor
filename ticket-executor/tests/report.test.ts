// The report's text, asserted line by line.
//
// It is worth its own suite because nothing downstream validates it: the output
// is copied straight into a chat group, so a wrong indent or a missing section
// is only ever noticed by the people reading the report.
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReport,
  defaultProgress,
  emptyDraft,
  emptyTasks,
  formatReportDay,
  ticketLine,
  type ReportDraftState,
} from "../lib/report";
import type { Ticket } from "../lib/types";

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: "1",
  title: "t",
  type: "User Story",
  status: "In Progress",
  assignee: "",
  project: "P",
  areaPath: "P",
  url: "",
  ...over,
});

const draft = (over: Partial<ReportDraftState>): ReportDraftState => ({
  ...emptyDraft("Ken Nguyen"),
  ...over,
});

test("a ticket line is what Azure DevOps' copy button produces", () => {
  assert.equal(
    ticketLine(ticket({ id: "23365", type: "User Story", title: "ACS - Plan Email System Updates Phase 2" })),
    "User Story 23365: ACS - Plan Email System Updates Phase 2"
  );
});

test("the date is the day the report heads itself with", () => {
  assert.equal(formatReportDay("2026-09-21"), "21/09/2026");
  assert.equal(formatReportDay("2026-09-21T10:00:00.000Z"), "21/09/2026");
});

test("progress defaults to the lane the ticket is already in", () => {
  assert.equal(defaultProgress(ticket({ status: "Code Review" })), "Code Review");
  assert.equal(defaultProgress(ticket({ status: "In QA" })), "In QA");
  assert.equal(defaultProgress(ticket({ status: "Closed" })), "Done");
  assert.equal(defaultProgress(ticket({ status: "In Progress" })), "50%");
  // The board column is what the team says out loud; the state is the fallback.
  assert.equal(defaultProgress(ticket({ status: "Active", boardColumn: "In QA" })), "In QA");
});

test("a full report reads exactly as it is pasted", () => {
  const tickets = [
    ticket({ id: "24600", title: "Index Fund Review - International Index Coverage (SPUSA05ITY)" }),
    ticket({ id: "23365", title: "ACS - Plan Email System Updates Phase 2" }),
  ];
  const text = buildReport({
    day: "2026-09-21",
    name: "Ken Nguyen",
    tickets,
    draft: draft({
      tasks: { ...emptyTasks(), sprintPlanning: { today: true, tomorrow: false } },
      entries: {
        "24600": { today: true, tomorrow: false, progress: "100%", comment: false, block: false },
        "23365": { today: false, tomorrow: true, progress: "", comment: true, block: true },
      },
    }),
  });

  assert.equal(
    text,
    [
      "Report 21/09/2026 of Ken Nguyen",
      " 1. Today",
      "  - Sprint planning",
      "  - User Story 24600: Index Fund Review - International Index Coverage (SPUSA05ITY) - 100%",
      " 2. Tomorrow",
      "  - User Story 23365: ACS - Plan Email System Updates Phase 2",
      "Comments:",
      " - User Story 23365: ACS - Plan Email System Updates Phase 2",
      "Blocks:",
      " - User Story 23365: ACS - Plan Email System Updates Phase 2",
      "Thanks",
    ].join("\n")
  );
});

test("an empty section says None rather than collapsing", () => {
  const text = buildReport({ day: "2026-09-21", name: "Ken Nguyen", tickets: [], draft: draft({}) });
  assert.equal(
    text,
    [
      "Report 21/09/2026 of Ken Nguyen",
      " 1. Today",
      "  - None",
      " 2. Tomorrow",
      "  - None",
      "Comments:",
      " - None",
      "Blocks:",
      " - None",
      "Thanks",
    ].join("\n")
  );
});

test("an unticked entry contributes nothing, in any section", () => {
  const tickets = [ticket({ id: "5", title: "Not today" })];
  const text = buildReport({
    day: "2026-09-21",
    name: "Ken Nguyen",
    tickets,
    draft: draft({
      entries: { "5": { today: false, tomorrow: false, progress: "80%", comment: true, block: true } },
    }),
  });
  assert.ok(!text.includes("Not today"));
  assert.ok(text.includes("  - None"));
});

test("a tomorrow line never carries progress, even with one stored", () => {
  const text = buildReport({
    day: "2026-09-21",
    name: "Ken Nguyen",
    tickets: [ticket({ id: "7", title: "Later" })],
    draft: draft({
      entries: { "7": { today: false, tomorrow: true, progress: "80%", comment: false, block: false } },
    }),
  });
  assert.ok(text.includes("  - User Story 7: Later\n"));
  assert.ok(!text.includes("80%"));
});

test("work carried overnight appears in both sections, with progress only in Today", () => {
  const text = buildReport({
    day: "2026-09-22",
    name: "Ken Nguyen",
    tickets: [ticket({ id: "23365", title: "ACS - Plan Email System Updates Phase 2" })],
    draft: draft({
      entries: { "23365": { today: true, tomorrow: true, progress: "60%", comment: false, block: false } },
    }),
  });
  assert.equal(
    text,
    [
      "Report 22/09/2026 of Ken Nguyen",
      " 1. Today",
      "  - User Story 23365: ACS - Plan Email System Updates Phase 2 - 60%",
      " 2. Tomorrow",
      "  - User Story 23365: ACS - Plan Email System Updates Phase 2",
      "Comments:",
      " - None",
      "Blocks:",
      " - None",
      "Thanks",
    ].join("\n")
  );
});

test("a ticket listed under Tomorrow only can still carry a comment or a block", () => {
  const text = buildReport({
    day: "2026-09-22",
    name: "Ken Nguyen",
    tickets: [ticket({ id: "9", title: "Next up" })],
    draft: draft({
      entries: { "9": { today: false, tomorrow: true, progress: "", comment: true, block: true } },
    }),
  });
  assert.ok(text.includes("Comments:\n - User Story 9: Next up"));
  assert.ok(text.includes("Blocks:\n - User Story 9: Next up"));
});
