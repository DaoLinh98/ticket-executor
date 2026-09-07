// The "is this ticket mine" rule, asserted without a database.
//
// It is worth its own suite because it is the gate every scheduled action will
// stand behind: a wrong answer here does not show up as an error, it shows up as
// the agent quietly working somebody else's ticket.
import test from "node:test";
import assert from "node:assert/strict";

import { hasIdentity, isMine, isMyPullRequest, mineOnly, myVoteOn, NO_IDENTITY, type DevIdentity } from "../lib/identity";
import type { PullRequestBrief, Ticket } from "../lib/types";

const KEN: DevIdentity = { email: "ken.nguyen@emesoft.net", name: "Ken Nguyen" };

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: "1",
  title: "t",
  type: "User Story",
  status: "Ready for Development",
  assignee: "",
  project: "P",
  areaPath: "P",
  url: "https://example.invalid/1",
  ...over,
});

test("no identity configured is not a filter that matches everything", () => {
  assert.equal(hasIdentity(NO_IDENTITY), false);
  assert.equal(isMine(ticket({ assigneeEmail: "ken.nguyen@emesoft.net" }), NO_IDENTITY), false);
  assert.deepEqual(mineOnly([ticket({ assignee: "Ken Nguyen" })], NO_IDENTITY), []);
});

test("email matches regardless of case", () => {
  assert.equal(isMine(ticket({ assigneeEmail: "Ken.Nguyen@EmeSoft.net" }), KEN), true);
});

test("display name is the fallback when the work item carries no email", () => {
  assert.equal(isMine(ticket({ assignee: "ken nguyen" }), KEN), true);
  assert.equal(isMine(ticket({ assignee: "Someone Else" }), KEN), false);
});

test("an email that belongs to someone else is not mine, whatever the name says", () => {
  const t = ticket({ assigneeEmail: "other@emesoft.net", assignee: "Ken Nguyen" });
  // The name still matches, and that is deliberate: providers do reassign work
  // items by name only. What must never happen is the reverse — a foreign email
  // alone counting as mine.
  assert.equal(isMine(ticket({ assigneeEmail: "other@emesoft.net", assignee: "" }), KEN), false);
  assert.equal(isMine(t, KEN), true);
});

test("an identity with only a name still filters", () => {
  const nameOnly: DevIdentity = { email: "", name: "Ken Nguyen" };
  assert.equal(hasIdentity(nameOnly), true);
  assert.equal(isMine(ticket({ assignee: "Ken Nguyen" }), nameOnly), true);
  assert.equal(isMine(ticket({ assigneeEmail: "ken.nguyen@emesoft.net" }), nameOnly), false);
});

test("mineOnly keeps only the developer's tickets", () => {
  const list = [
    ticket({ id: "1", assigneeEmail: "ken.nguyen@emesoft.net" }),
    ticket({ id: "2", assignee: "Someone Else" }),
    ticket({ id: "3", assignee: "Ken Nguyen" }),
  ];
  assert.deepEqual(mineOnly(list, KEN).map((t) => t.id), ["1", "3"]);
});

// ---- pull requests ----
//
// The reviewer inbox rests on two answers that a wrong guess makes silently
// wrong: whose pull request this is, and whether the developer owes it a vote.

const pr = (over: Partial<PullRequestBrief> = {}): PullRequestBrief => ({
  id: "10517",
  url: "https://dev.azure.com/org/Proj/_git/Repo/pullrequest/10517",
  title: "Fix the thing",
  repo: "Repo",
  isDraft: false,
  mergeStatus: "succeeded",
  authorEmail: "dev@example.com",
  authorName: "Dev Example",
  reviewers: [],
  ...over,
});

const me: DevIdentity = { email: "dev@example.com", name: "Dev Example" };

test("a pull request is mine by email", () => {
  assert.equal(isMyPullRequest(pr(), me), true);
});

test("a pull request is mine by display name when the address differs", () => {
  // Azure DevOps spells the same person differently per organization; the
  // display name is the fallback isMine() already relies on.
  assert.equal(isMyPullRequest(pr({ authorEmail: "dev@client-org.com" }), me), true);
});

test("somebody else's pull request is not mine", () => {
  assert.equal(isMyPullRequest(pr({ authorEmail: "other@example.com", authorName: "Other Person" }), me), false);
});

test("with no identity configured no pull request is mine", () => {
  assert.equal(isMyPullRequest(pr(), NO_IDENTITY), false);
  assert.equal(myVoteOn(pr({ reviewers: [{ email: "dev@example.com", name: "Dev Example", vote: 0 }] }), NO_IDENTITY), null);
});

test("not being a reviewer is null, not a zero vote", () => {
  // The whole reviewer inbox is "vote === 0"; conflating it with "not asked"
  // would put every pull request in the organization on the bell.
  assert.equal(myVoteOn(pr(), me), null);
  assert.equal(myVoteOn(pr({ reviewers: [{ email: "dev@example.com", name: "Dev Example", vote: 0 }] }), me), 0);
});

test("a cast vote is returned as the provider's own value", () => {
  assert.equal(myVoteOn(pr({ reviewers: [{ email: "dev@example.com", name: "Dev Example", vote: 10 }] }), me), 10);
  assert.equal(myVoteOn(pr({ reviewers: [{ email: "dev@example.com", name: "Dev Example", vote: -5 }] }), me), -5);
});

test("a team reviewer carries no address and does not match the person", () => {
  // ADO returns `vstfs:///…` as a group reviewer's unique name, which the ADO
  // client maps to an empty email. An empty email must never match an identity.
  const teamOnly = pr({ reviewers: [{ email: "", name: "27G-Cloud-Ops", vote: 0 }] });
  assert.equal(myVoteOn(teamOnly, me), null);
});

test("an empty reviewer address never matches an empty identity email", () => {
  const nameOnly: DevIdentity = { email: "", name: "Dev Example" };
  assert.equal(myVoteOn(pr({ reviewers: [{ email: "", name: "27G-Cloud-Ops", vote: 0 }] }), nameOnly), null);
});
