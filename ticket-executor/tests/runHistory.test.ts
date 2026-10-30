import test from "node:test";
import assert from "node:assert/strict";
import { GRAPHS, graphIdsOf } from "../lib/dagent/graph";
import { historyPage, historySlice, historyWhere, pageCount, parseHistoryFilter, type HistoryRunRow } from "../lib/dagent/history";

const run = (id: string, at: number, extra: Partial<HistoryRunRow> = {}): HistoryRunRow => ({
  id,
  ticketId: "4182",
  ticketTitle: "Export invoices",
  ticketUrl: "",
  project: "billing",
  graphId: GRAPHS.implement.id,
  state: "succeeded",
  waitReason: "",
  currentNodeId: "verifyPublish",
  errorMessage: "",
  branch: "feature/4182-export",
  prUrl: "",
  retryOfId: "",
  startedAt: new Date(at),
  endedAt: new Date(at + 60_000),
  ...extra,
});

test("parseHistoryFilter keeps known values and drops the rest", () => {
  assert.deepEqual(parseHistoryFilter(new URLSearchParams("state=failed&flow=fix-review&q=  4182 &page=3&size=50")), { state: "failed", flow: "fix-review", q: "4182", page: 3, size: 50 });
  assert.deepEqual(parseHistoryFilter(new URLSearchParams("state=exploded&flow=review&page=-2&size=7")), { state: "", flow: "", q: "", page: 1, size: 25 });
});

test("historyWhere maps a flow label onto every graph id of that flow, legacy included", () => {
  assert.deepEqual(historyWhere({ state: "", flow: "", q: "" }), {});
  const w = historyWhere({ state: "", flow: "fix-qa", q: "" }) as { AND: { graphId: { in: string[] } }[] };
  assert.deepEqual(w.AND[0].graphId.in, graphIdsOf("qa"));
  assert.ok(graphIdsOf("qa").length > 1);
});

test("historySlice skips whole pages and serves the last page when asked past it", () => {
  const f = { state: "", flow: "", q: "", page: 3, size: 25 };
  assert.deepEqual(historySlice(f, 120), { page: 3, skip: 50 });
  assert.deepEqual(historySlice({ ...f, page: 9 }, 120), { page: 5, skip: 100 });
  assert.deepEqual(historySlice(f, 0), { page: 1, skip: 0 });
  assert.deepEqual([pageCount(0, 25), pageCount(25, 25), pageCount(26, 25)], [1, 1, 2]);
});

test("historyPage folds step totals and labels the node", () => {
  const runs = [run("b", 2000, { state: "running", currentNodeId: "setup", endedAt: null }), run("a", 1000, { currentNodeId: "fix", state: "failed" })];
  const page = historyPage(
    runs,
    [
      { runId: "a", nodeId: "implement", count: 1, costUsd: 1.5, tokens: 1000 },
      { runId: "a", nodeId: "fix", count: 3, costUsd: 0.5, tokens: 200 },
    ],
    40,
    2,
    25,
  );
  assert.deepEqual([page.total, page.page, page.size, page.rows.length], [40, 2, 25, 2]);
  assert.equal(page.rows[0].state, "preparing");
  assert.equal(page.rows[0].costUsd, 0);
  assert.deepEqual([page.rows[1].costUsd, page.rows[1].tokens, page.rows[1].fixes], [2, 1200, 3]);
  assert.equal(page.rows[1].nodeLabel, GRAPHS.implement.nodes.fix.label);
  assert.equal(page.rows[1].flow, "implement");
});
