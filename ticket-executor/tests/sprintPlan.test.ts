// The sprint arithmetic, asserted without a provider or a database.
//
// This suite is the reason the planner is a pure module: the release calendar is
// what the scheduler will act on unattended, so "an eight-point ticket lands on
// day four" has to be a fact somebody can check in a second, not a behaviour
// somebody observes a fortnight later.
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PLAN_CONFIG,
  buildPlan,
  deliverablesOnly,
  isDeliverable,
  laneOf,
  releasesOn,
  retryDenial,
  summarize,
  ticketHours,
  workingDays,
  type PlanInput,
  type SprintWindow,
} from "../lib/sprintPlan";
import type { Ticket } from "../lib/types";

// Mon 2026-09-07 → Fri 2026-09-18: a two-week sprint, ten working days.
const SPRINT: SprintWindow = { startDate: "2026-09-07", finishDate: "2026-09-18" };
const CFG = DEFAULT_PLAN_CONFIG; // 4h/point, 8h/day, 2pts/day, no ticket ceiling

const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  title: "Ticket " + id,
  type: "User Story",
  status: "Ready for Development",
  assignee: "Ken Nguyen",
  project: "P",
  areaPath: "P",
  url: "https://example.invalid/" + id,
  ...over,
});

const input = (id: string, points: number, over: Partial<Ticket> = {}): PlanInput => ({
  ticket: ticket(id, { storyPoints: points, ...over }),
});

// ---- working days ----

test("working days exclude weekends and include both ends", () => {
  const days = workingDays(SPRINT.startDate, SPRINT.finishDate);
  assert.equal(days.length, 10);
  assert.equal(days[0], "2026-09-07");
  assert.equal(days[9], "2026-09-18");
  assert.ok(!days.includes("2026-09-12"), "Saturday is not a working day");
});

test("a window starting on a weekend still starts on the first weekday", () => {
  assert.deepEqual(workingDays("2026-09-05", "2026-09-08"), ["2026-09-07", "2026-09-08"]);
});

// ---- deliverables ----

test("Azure DevOps hierarchy containers are not tickets", () => {
  for (const type of ["Epic", "Feature", "Task", "Test Case"]) {
    assert.equal(isDeliverable(ticket("1", { type }), "azure-devops"), false, type);
  }
  for (const type of ["User Story", "Bug", "Product Backlog Item"]) {
    assert.equal(isDeliverable(ticket("1", { type }), "azure-devops"), true, type);
  }
});

test("a provider with no hierarchy keeps every type", () => {
  assert.equal(isDeliverable(ticket("1", { type: "Feature" }), "github"), true);
  assert.equal(isDeliverable(ticket("1", { type: "Issue" }), "github"), true);
});

// The sprint the user hit: one User Story split into four Tasks, all assigned to
// the same developer. Five rows describing one eight-point unit of work.
test("a story and its child tasks count as one ticket", () => {
  const rows = [
    ticket("17655", { type: "User Story", storyPoints: 8 }),
    ticket("29375", { type: "Task" }),
    ticket("29376", { type: "Task" }),
    ticket("29377", { type: "Task" }),
    ticket("29378", { type: "Task" }),
  ];
  const kept = deliverablesOnly(rows, "azure-devops");
  assert.deepEqual(kept.map((t) => t.id), ["17655"]);
});

// ---- lanes ----

test("lanes classify the four states capacity maths cares about", () => {
  assert.equal(laneOf("Ready for Development"), "todo");
  assert.equal(laneOf("In Progress"), "doing");
  assert.equal(laneOf("Code Review"), "review");
  assert.equal(laneOf("Closed"), "done");
  assert.equal(laneOf("Something A Process Template Invented"), "todo");
  assert.equal(laneOf("In QA"), "review");
  assert.equal(laneOf("QA Passed"), "review");
  assert.equal(laneOf("QA Failed"), "doing");
  assert.equal(laneOf("Blocked"), "doing");
  assert.equal(laneOf("Resolved"), "done");
});

// ---- sizing ----

test("points drive hours, and an hour estimate is the fallback", () => {
  assert.equal(ticketHours(input("1", 3), CFG), 12);
  assert.equal(ticketHours({ ticket: ticket("2", { estimateHours: 5 }) }, CFG), 5);
  assert.equal(ticketHours({ ticket: ticket("3") }, CFG), 0);
});

test("a re-estimate from triage overrides the provider's sizing", () => {
  assert.equal(ticketHours({ ticket: ticket("1", { storyPoints: 3 }), points: 8 }, CFG), 32);
});

// ---- summary ----

test("the sprint the user described: 5 tickets, 16 points", () => {
  const s = summarize(
    [input("1", 3), input("2", 5), input("3", 2), input("4", 5), input("5", 1)],
    SPRINT,
    "2026-09-07",
    CFG
  );
  assert.equal(s.ticketCount, 5);
  assert.equal(s.totalPoints, 16);
  assert.equal(s.workingDaysTotal, 10);
  assert.equal(s.workingDaysLeft, 10);
  assert.equal(s.capacityHours, 80);
  assert.equal(s.requiredHours, 64); // 16 points x 4h
  assert.equal(s.slackHours, 16);
  assert.equal(s.verdict, "on-track");
});

test("capacity shrinks as the sprint burns down, and over-commitment is named", () => {
  const work = [input("1", 5), input("2", 5), input("3", 5)]; // 60h
  assert.equal(summarize(work, SPRINT, "2026-09-07", CFG).verdict, "on-track"); // 80h left
  const late = summarize(work, SPRINT, "2026-09-15", CFG); // Tue of week 2 → 4 days
  assert.equal(late.workingDaysLeft, 4);
  assert.equal(late.capacityHours, 32);
  assert.equal(late.slackHours, -28);
  assert.equal(late.verdict, "over-committed");
});

test("work in review or done costs no remaining hours but still counts as points", () => {
  const s = summarize(
    [input("1", 5, { status: "Closed" }), input("2", 5, { status: "Code Review" }), input("3", 2)],
    SPRINT,
    "2026-09-07",
    CFG
  );
  assert.equal(s.totalPoints, 12);
  assert.equal(s.donePoints, 5);
  assert.equal(s.remainingPoints, 7);
  assert.equal(s.requiredHours, 8, "only the todo ticket still needs hours");
  assert.equal(s.byLane.review.tickets, 1);
});

test("unsized tickets are reported, not silently treated as free", () => {
  const s = summarize([input("1", 3), { ticket: ticket("2") }], SPRINT, "2026-09-07", CFG);
  assert.equal(s.unsizedCount, 1);
});

test("a provider with no iteration dates yields no calendar rather than a fake one", () => {
  const s = summarize([input("1", 3)], { startDate: "", finishDate: "" }, "2026-09-07", CFG);
  assert.equal(s.verdict, "no-calendar");
  assert.equal(s.workingDaysTotal, 0);
});

// ---- claims ----

// The sprint the user described: five tickets at the start, three of them
// finished and handed to QA by mid-sprint. The scope must read five and sixteen
// points all fortnight, and only the two still in hand may cost hours.
test("handed-off work stays in the scope but costs no capacity", () => {
  const inputs: PlanInput[] = [
    { ticket: ticket("1", { storyPoints: 3, status: "In Progress" }) },
    { ticket: ticket("2", { storyPoints: 5, status: "Ready for Development" }) },
    { ticket: ticket("3", { storyPoints: 3 }), claim: "handed-off", assigneeNow: "Ryan Huynh" },
    { ticket: ticket("4", { storyPoints: 3 }), claim: "handed-off", assigneeNow: "Ryan Huynh" },
    { ticket: ticket("5", { storyPoints: 2 }), claim: "handed-off", assigneeNow: "Ryan Huynh" },
  ];
  const s = summarize(inputs, SPRINT, SPRINT.startDate, CFG);

  assert.equal(s.ticketCount, 5);
  assert.equal(s.totalPoints, 16);
  assert.deepEqual(s.mine, { tickets: 2, points: 8 });
  assert.deepEqual(s.handedOff, { tickets: 3, points: 8 });
  assert.equal(s.donePoints, 8, "handed-off work is delivered work");
  assert.equal(s.requiredHours, 32, "only the two still in hand: 8pt x 4h");
});

test("a dropped ticket is counted nowhere but reported", () => {
  const inputs: PlanInput[] = [
    { ticket: ticket("1", { storyPoints: 3 }) },
    { ticket: ticket("2", { storyPoints: 99 }), claim: "dropped" },
  ];
  const s = summarize(inputs, SPRINT, SPRINT.startDate, CFG);

  assert.equal(s.ticketCount, 1);
  assert.equal(s.totalPoints, 3);
  assert.equal(s.droppedCount, 1);
  assert.equal(s.requiredHours, 12);
  assert.equal(s.byLane.todo.tickets, 1, "the dropped ticket is in no lane");
});

test("a ticket that changed hands is never queued or dated", () => {
  const plan = buildPlan(
    [
      { ticket: ticket("1", { storyPoints: 2, status: "Ready for Development" }) },
      { ticket: ticket("2", { storyPoints: 2, status: "In Progress" }), claim: "handed-off" },
      { ticket: ticket("3", { storyPoints: 2, status: "In Progress" }), claim: "dropped" },
    ],
    SPRINT,
    SPRINT.startDate,
    CFG
  );
  const by = new Map(plan.tickets.map((t) => [t.ticketId, t]));

  assert.equal(by.get("1")!.implementOrder, 1);
  assert.equal(by.get("1")!.releaseDay, SPRINT.startDate);

  // Both have a live "In Progress" status, and neither may be acted on: the
  // status belongs to whoever holds the ticket now.
  for (const id of ["2", "3"]) {
    assert.equal(by.get(id)!.implementOrder, 0, id + " is not queued");
    assert.equal(by.get(id)!.releaseDay, "", id + " has no release day");
  }
  assert.equal(by.get("2")!.lane, "done", "handed off is delivered");
  assert.equal(by.get("3")!.lane, "todo", "dropped was never started");
});

// ---- allocation ----

test("release spreads evenly by points, not by ticket count", () => {
  const plan = buildPlan(
    [input("1", 2), input("2", 2), input("3", 2)],
    SPRINT,
    "2026-09-07",
    CFG
  );
  const days = plan.tickets.map((t) => t.releaseDay);
  assert.deepEqual(days, ["2026-09-07", "2026-09-08", "2026-09-09"]);
  assert.equal(plan.overflowPoints, 0);
});

test("a ticket bigger than a day's pace lands on the last day it spans", () => {
  const plan = buildPlan([input("1", 8), input("2", 2)], SPRINT, "2026-09-07", CFG);
  // 8 points at 2/day = four working days: Mon..Thu, released Thursday.
  assert.equal(plan.tickets[0].releaseDay, "2026-09-10");
  assert.equal(plan.tickets[1].releaseDay, "2026-09-11");
});

test("small tickets share a day up to the pace", () => {
  const plan = buildPlan([input("1", 1), input("2", 1), input("3", 1)], SPRINT, "2026-09-07", CFG);
  assert.deepEqual(
    plan.tickets.map((t) => t.releaseDay),
    ["2026-09-07", "2026-09-07", "2026-09-08"]
  );
});

test("a ticket-per-day ceiling overrides the pace", () => {
  const plan = buildPlan(
    [input("1", 1), input("2", 1), input("3", 1)],
    SPRINT,
    "2026-09-07",
    { ...CFG, maxTicketsPerDay: 1 }
  );
  assert.deepEqual(
    plan.tickets.map((t) => t.releaseDay),
    ["2026-09-07", "2026-09-08", "2026-09-09"]
  );
});

test("triage's work order drives the queue, and ties keep the given order", () => {
  const plan = buildPlan(
    [
      { ...input("A", 2), order: 3 },
      { ...input("B", 2), order: 1 },
      input("C", 2),
      input("D", 2),
    ],
    SPRINT,
    "2026-09-07",
    CFG
  );
  assert.deepEqual(plan.tickets.map((t) => t.ticketId), ["B", "A", "C", "D"]);
  assert.deepEqual(plan.tickets.map((t) => t.implementOrder), [1, 2, 3, 4]);
});

test("tickets already handed over take no release capacity", () => {
  const plan = buildPlan(
    [input("1", 5, { status: "Code Review" }), input("2", 2)],
    SPRINT,
    "2026-09-07",
    CFG
  );
  assert.equal(plan.tickets[0].releaseDay, "", "already in review — nothing to release");
  assert.equal(plan.tickets[0].implementOrder, 0);
  assert.equal(plan.tickets[1].releaseDay, "2026-09-07", "the queue starts on day one");
});

test("tickets already with QA are never queued for implementation", () => {
  const plan = buildPlan(
    [
      input("1", 3, { status: "In QA" }),
      input("2", 3, { status: "QA Failed" }),
      input("3", 3, { status: "QA Passed" }),
      input("4", 3, { status: "Resolved" }),
      input("5", 2),
    ],
    SPRINT,
    "2026-09-07",
    CFG
  );
  assert.deepEqual(plan.tickets.map((t) => t.implementOrder), [0, 0, 0, 0, 1]);
  assert.deepEqual(plan.tickets.slice(0, 4).map((t) => t.releaseDay), ["", "", "", ""]);
});

test("each planned ticket carries the project it belongs to", () => {
  const plan = buildPlan([input("1", 2, { project: "Audit Center" })], SPRINT, "2026-09-07", CFG);
  assert.equal(plan.tickets[0].project, "Audit Center");
});

test("work the pace cannot fit before the sprint ends overflows rather than piling onto the last day", () => {
  // 30 points at 2/day needs 15 working days; the sprint has 10.
  const plan = buildPlan(
    Array.from({ length: 15 }, (_, i) => input(String(i + 1), 2)),
    SPRINT,
    "2026-09-07",
    CFG
  );
  assert.equal(plan.overflowPoints, 10);
  assert.equal(plan.tickets.filter((t) => t.releaseDay === "").length, 5);
  assert.equal(plan.tickets.filter((t) => t.releaseDay === "2026-09-18").length, 1);
});

test("without a calendar tickets are still queued, just never dated", () => {
  const plan = buildPlan([input("1", 2), input("2", 2)], { startDate: "", finishDate: "" }, "2026-09-07", CFG);
  assert.deepEqual(plan.tickets.map((t) => t.implementOrder), [1, 2]);
  assert.deepEqual(plan.tickets.map((t) => t.releaseDay), ["", ""]);
});

test("releasesOn answers the scheduler's daily question", () => {
  const plan = buildPlan([input("1", 1), input("2", 1), input("3", 2)], SPRINT, "2026-09-07", CFG);
  assert.deepEqual(releasesOn(plan, "2026-09-07").map((t) => t.ticketId), ["1", "2"]);
  assert.deepEqual(releasesOn(plan, "2026-09-08").map((t) => t.ticketId), ["3"]);
  assert.deepEqual(releasesOn(plan, "2026-09-09"), []);
});

test("a blocked ticket is planned and counted, but carries the flag that stops a run", () => {
  const plan = buildPlan([{ ...input("1", 2), blocked: true }], SPRINT, "2026-09-07", CFG);
  assert.equal(plan.tickets[0].blocked, true);
  assert.equal(plan.tickets[0].releaseDay, "2026-09-07");
});

test("a window that closed before the build date is moved forward to start on it", () => {
  // Mon 2026-05-04 → Fri 2026-05-15: ten working days, all in the past.
  const closed: SprintWindow = { startDate: "2026-05-04", finishDate: "2026-05-15" };
  const plan = buildPlan([input("1", 2), input("2", 2)], closed, "2026-09-07", CFG);
  assert.deepEqual(plan.tickets.map((t) => t.releaseDay), ["2026-09-07", "2026-09-08"]);
  assert.equal(plan.summary.workingDaysLeft, 10);
  assert.equal(plan.overflowPoints, 0);
});

test("a window still open keeps clamping to today rather than shifting", () => {
  const plan = buildPlan([input("1", 2)], SPRINT, "2026-09-14", CFG);
  assert.equal(plan.tickets[0].releaseDay, "2026-09-14");
  assert.equal(plan.summary.workingDaysLeft, 5);
});

// ---- retrying a ticket the queue has stopped asking about ----
// A rebuild deliberately will not requeue a settled row, so this rule is the
// only way back — and its refusals are what stop it becoming a duplicate-PR
// button.

const STOPPED = { implementState: "failed", prUrl: "", claim: "mine" };

test("retry: a failed run may be queued again", () => {
  assert.equal(retryDenial(STOPPED), "");
  assert.equal(retryDenial({ ...STOPPED, implementState: "skipped" }), "");
});

test("retry: a row that already opened a pull request never runs again", () => {
  // The one-shot flow publishes inside the turn it verifies in, so `failed` with
  // a PR attached is a real state — and retrying it is a second pull request.
  const d = retryDenial({ ...STOPPED, prUrl: "https://dev.azure.com/pr/1" });
  assert.match(d, /second one/);
});

test("retry: finished or in-flight work is refused", () => {
  for (const implementState of ["running", "implemented", "pending"]) {
    assert.notEqual(retryDenial({ ...STOPPED, implementState }), "");
  }
});

test("retry: a ticket that was never queued is not requeued", () => {
  assert.match(retryDenial({ ...STOPPED, implementOrder: 0 }), /not in the implement queue/);
  assert.equal(retryDenial({ ...STOPPED, implementOrder: 3 }), "");
});

test("retry: a ticket that changed hands is not yours to requeue", () => {
  for (const claim of ["handed-off", "dropped"]) {
    assert.match(retryDenial({ ...STOPPED, claim }), /no longer assigned/);
  }
});
