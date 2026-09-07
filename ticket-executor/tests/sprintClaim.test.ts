// Who a sprint belonged to, asserted without a tracker or a database.
//
// The bug this module exists to prevent is a quiet one: a sprint report built
// from live assignment shrinks every time the developer finishes something, so
// the better the fortnight goes the emptier the page looks. These tests are the
// statement that it does not.
import test from "node:test";
import assert from "node:assert/strict";

import { NO_IDENTITY, type DevIdentity } from "../lib/identity";
import { claimOf, claimSprint, type Remembered } from "../lib/sprintClaim";
import type { Ticket } from "../lib/types";

const KEN: DevIdentity = { email: "ken.nguyen@emesoft.net", name: "Ken Nguyen" };

const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  title: "Ticket " + id,
  type: "User Story",
  status: "In Progress",
  assignee: "Ken Nguyen",
  assigneeEmail: "ken.nguyen@emesoft.net",
  project: "P",
  areaPath: "P",
  url: "https://example.invalid/" + id,
  ...over,
});

const qa = (id: string, over: Partial<Ticket> = {}) =>
  ticket(id, {
    status: "In QA",
    assignee: "Ryan Huynh",
    assigneeEmail: "ryan.huynh@emesoft.net",
    ...over,
  });

const remembered = (id: string, worked: boolean, points = 0): Remembered => ({
  ticketId: id,
  title: "Ticket " + id,
  points,
  estimateHours: 0,
  worked,
});

// ---- the rule itself ----

test("a ticket still assigned to the developer is theirs", () => {
  assert.equal(claimOf(ticket("1"), KEN, false), "mine");
  assert.equal(claimOf(ticket("1"), KEN, true), "mine");
});

test("reassigned after the app worked it is handed off, not lost", () => {
  assert.equal(claimOf(qa("1"), KEN, true), "handed-off");
});

test("reassigned without ever being worked is a scope change", () => {
  assert.equal(claimOf(qa("1"), KEN, false), "dropped");
});

test("a ticket that left the sprint keeps the claim its work earned", () => {
  assert.equal(claimOf(undefined, KEN, true), "handed-off");
  assert.equal(claimOf(undefined, KEN, false), "dropped");
});

test("with no identity nothing is the developer's, worked or not", () => {
  // `isMine` refuses to match on an unconfigured connection, so a live ticket
  // cannot be `mine` here. Work the app actually did still counts — that
  // evidence does not depend on knowing the developer's email.
  assert.equal(claimOf(ticket("1"), NO_IDENTITY, false), "dropped");
  assert.equal(claimOf(ticket("1"), NO_IDENTITY, true), "handed-off");
});

// ---- the merge ----

test("the sprint does not shrink when finished work moves to QA", () => {
  // Five tickets at the start of the sprint; by mid-sprint three are finished
  // and reassigned to QA, one is still being worked, one was given away
  // untouched.
  const live = [ticket("1"), qa("2"), qa("3"), qa("4"), qa("5")];
  const claimed = claimSprint(
    live,
    [
      remembered("1", false, 3),
      remembered("2", true, 3),
      remembered("3", true, 5),
      remembered("4", true, 2),
      remembered("5", false, 3),
    ],
    KEN
  );

  assert.equal(claimed.length, 5, "every ticket is still on the report");
  assert.deepEqual(
    claimed.map((c) => c.claim),
    ["mine", "handed-off", "handed-off", "handed-off", "dropped"]
  );
  assert.equal(claimed[1].assigneeNow, "Ryan Huynh", "the page can say who holds it");
  assert.equal(claimed[0].assigneeNow, "", "a ticket still theirs names nobody else");
});

test("work that lands mid-sprint is appended, not ignored", () => {
  const claimed = claimSprint([ticket("1"), ticket("9")], [remembered("1", false)], KEN);
  assert.deepEqual(claimed.map((c) => c.ticket.id), ["1", "9"]);
  assert.equal(claimed[1].claim, "mine");
});

test("somebody else's ticket the plan never saw stays off the report", () => {
  const claimed = claimSprint([ticket("1"), qa("7")], [remembered("1", false)], KEN);
  assert.deepEqual(claimed.map((c) => c.ticket.id), ["1"]);
});

test("a ticket that left the sprint is rebuilt from the plan, flagged as such", () => {
  const claimed = claimSprint([], [remembered("42", true, 5)], KEN);
  assert.equal(claimed.length, 1);
  const only = claimed[0];
  assert.equal(only.claim, "handed-off");
  assert.equal(only.fromPlan, true);
  assert.equal(only.ticket.storyPoints, 5, "its points survive so the sprint total does");
  assert.equal(only.ticket.status, "", "no status is invented for a row nobody can read");
  assert.equal(only.assigneeNow, "", "and no assignee either — there is no live row");
});

// ---- what the scheduler acts on ----

// The abort path in `refreshClaims()` fires on exactly one condition: a row
// whose stored claim differs from the one the live sprint now implies. These are
// the transitions it has to detect, stated here because the scheduler's own
// half needs a database and this half does not.
test("the transitions the scheduler must notice", () => {
  const worked = true;
  // Taken over mid-run, after the app had already done work on it.
  assert.equal(claimOf(qa("1"), KEN, worked), "handed-off");
  // Taken over mid-run before anything shipped — still not the developer's, and
  // still a run that must stop.
  assert.equal(claimOf(qa("1"), KEN, false), "dropped");
  // Handed back. Nothing to stop, and the queue may pick it up again.
  assert.equal(claimOf(ticket("1"), KEN, false), "mine");
});

test("an empty sprint read would reassign everything — which is why the caller refuses it", () => {
  // Not a rule this module enforces, but the reason `refreshClaims()` bails on a
  // disconnected or empty provider response: with no live tickets, every claim
  // flips away from `mine` at once.
  const claimed = claimSprint([], [remembered("1", true), remembered("2", false)], KEN);
  assert.deepEqual(claimed.map((c) => c.claim), ["handed-off", "dropped"]);
});
