import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previewTick, type PreviewInput } from "../lib/execution/tickPreview";

const base: PreviewInput = {
  autoImplement: true,
  autoRelease: true,
  due: [],
  releaseExhausted: new Set(),
  failed: [],
  queue: [],
  blockedWaiting: 0,
  hasRootRepo: () => true,
  maxRetries: 2,
};
const q = (ticketId: string, project = "P", implementOrder = 1) => ({ ticketId, project, implementOrder, releaseDay: "2026-11-30", overridden: false });
const failed = (ticketId: string, o: Partial<PreviewInput["failed"][number]> = {}) => ({ ticketId, project: "P", transient: true, retriesUsed: 0, overBudget: false, ...o });

describe("previewTick", () => {
  it("starts only the first queued ticket", () => {
    const r = previewTick({ ...base, queue: [q("1"), q("2", "P", 2)] });
    assert.deepEqual(r.steps.map((s) => [s.action, s.ticketId]), [["implement", "1"]]);
  });

  it("holds a queued ticket with no root repo and moves on to the next", () => {
    const r = previewTick({ ...base, queue: [q("1", "A"), q("2", "B", 2)], hasRootRepo: (p) => p === "B" });
    assert.deepEqual(r.steps.map((s) => s.ticketId), ["2"]);
    assert.deepEqual(r.held.map((h) => [h.ticketId, h.action]), [["1", "implement"]]);
  });

  it("retries a transient failure before the queue", () => {
    const r = previewTick({ ...base, failed: [failed("9")], queue: [q("1")] });
    assert.deepEqual(r.steps.map((s) => [s.action, s.ticketId]), [["retry", "9"]]);
  });

  it("holds a transient failure that is over budget or out of retries, and falls through to the queue", () => {
    const r = previewTick({ ...base, failed: [failed("8", { overBudget: true }), failed("9", { retriesUsed: 2 })], queue: [q("1")] });
    assert.deepEqual(r.steps.map((s) => [s.action, s.ticketId]), [["implement", "1"]]);
    assert.deepEqual(r.held.map((h) => h.ticketId), ["8", "9"]);
  });

  it("ignores a failure that is not transient", () => {
    const r = previewTick({ ...base, failed: [failed("9", { transient: false })] });
    assert.deepEqual(r.steps, []);
    assert.deepEqual(r.held, []);
  });

  it("releases every due ticket and holds one whose releases keep failing", () => {
    const r = previewTick({ ...base, due: [{ ticketId: "1", releaseDay: "d" }, { ticketId: "2", releaseDay: "d" }], releaseExhausted: new Set(["2"]) });
    assert.deepEqual(r.steps.map((s) => [s.action, s.ticketId]), [["release", "1"]]);
    assert.deepEqual(r.held.map((h) => h.ticketId), ["2"]);
  });

  it("does nothing for a switched-off automation and says so", () => {
    const r = previewTick({ ...base, autoImplement: false, autoRelease: false, due: [{ ticketId: "1", releaseDay: "d" }], queue: [q("1")] });
    assert.deepEqual(r.steps, []);
    assert.ok(r.notes.some((n) => n.includes("Auto-release is off")));
    assert.ok(r.notes.some((n) => n.includes("Auto-implement is off")));
  });

  it("notes an empty queue and tickets waiting on the PO", () => {
    const r = previewTick({ ...base, blockedWaiting: 2 });
    assert.ok(r.notes.some((n) => n.includes("Nothing is queued")));
    assert.ok(r.notes.some((n) => n.startsWith("2 tickets are held back")));
  });
});
