"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { COLORS, FONT, SURFACE, card, chipShape, fieldInput, pill, tintedCard } from "@/lib/ui";
import { HISTORY_FLOWS, HISTORY_STATES, type HistoryRow } from "@/lib/dagent/historyShape";
import { dur, ktok, usd } from "@/lib/workflow/meta";
import { RUN_HISTORY_PREFIX, useRunHistory, type RunHistoryFilter } from "../../queries";
import { useLiveInvalidate } from "../../useLive";
import LoadingRing from "../../ticket-executor/LoadingRing";
import { useNow } from "../../ticket-executor/execution/useNow";
import { stateColor } from "../../ticket-executor/workflow/RunPicker";
import { MONO } from "../../ticket-executor/workflow/parts";
import SelectMenu from "../../SelectMenu";
import PageHeading from "../PageHeading";
import NotificationCenter from "../NotificationCenter";
import ProviderBadge from "../ProviderBadge";
import PageToolbar from "../PageToolbar";

// Every D-Agent run, newest first, for the developer to review; a row opens that exact run on /workflow.
// The filters live in the URL, so a filtered view is a link and Back returns to it.

const GRID = "minmax(240px, 2.6fr) 96px 130px minmax(120px, 1.2fr) 110px 84px 96px 64px";
const COLUMNS = ["Ticket", "Flow", "State", "Stopped at", "Started", "Duration", "Cost", "PR"];
const ACTIVE = ["running", "preparing", "waiting"];

const startedOf = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function RunRow({ row, now, onOpen }: { row: HistoryRow; now: number; onOpen: () => void }) {
  const live = ACTIVE.includes(row.state);
  return (
    <div
      className="te-plan-row te-run-row"
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      title="Open this run's workflow"
      style={{ display: "grid", gridTemplateColumns: GRID, gap: "10px", alignItems: "center", padding: "11px 14px", borderBottom: `1px solid ${COLORS.borderSubtle}`, cursor: "pointer", fontSize: FONT.base, color: COLORS.textSoft }}
    >
      <div className="te-plan-ticket" style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ ...chipShape(6), flex: "0 0 auto", padding: "3px 7px", fontSize: FONT.xs, fontFamily: MONO, background: "var(--te-indigo-soft)", color: COLORS.indigo }}>{row.ticketId}</span>
        <span className="te-run-title" style={{ minWidth: 0, color: COLORS.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={row.title}>
          {row.title || "Untitled ticket"}
        </span>
        {row.retryOf ? <span style={pill({ color: COLORS.textDim, border: COLORS.border, size: "xs" })} title="Started as a retry of an earlier run">retry</span> : null}
      </div>
      <div className="te-plan-cell" data-label="Flow">{row.flow}</div>
      <div className="te-plan-cell" data-label="State">
        <span style={pill({ color: stateColor(row.state), border: COLORS.border, size: "xs" })}>
          {row.state}
          {row.waitReason && row.state === "waiting" ? ` · ${row.waitReason}` : ""}
        </span>
      </div>
      <div className="te-plan-cell" data-label="At" title={row.error || undefined} style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: row.state === "failed" ? COLORS.danger : COLORS.textSoft }}>
        {row.nodeLabel || "—"}
        {row.fixes ? <span style={{ color: COLORS.textDim }}>{` · ${row.fixes} fix${row.fixes === 1 ? "" : "es"}`}</span> : null}
      </div>
      <div className="te-plan-cell" data-label="Started">{startedOf(row.startedAt)}</div>
      <div className="te-plan-cell" data-label="Took">{dur(((row.endedAt ?? (live ? now : row.startedAt)) - row.startedAt) / 1000)}</div>
      <div className="te-plan-cell" data-label="Cost" title={`${ktok(row.tokens)} tokens`}>{usd(row.costUsd)}</div>
      <div className="te-plan-cell" data-label="">
        {row.prUrl ? (
          <a
            href={row.prUrl}
            target="_blank"
            rel="noreferrer"
            className="te-run-pr"
            onClick={(e) => e.stopPropagation()}
            title="Open the pull request"
            style={{ ...chipShape(6), display: "inline-flex", alignItems: "center", padding: "3px 9px", fontSize: FONT.xs, fontWeight: 700, color: COLORS.accent, textDecoration: "none" }}
          >
            PR ↗
          </a>
        ) : (
          <span style={{ color: COLORS.faint }}>—</span>
        )}
      </div>
    </div>
  );
}

// Scrolling within this distance of the bottom loads the next page.
const LOAD_MORE_THRESHOLD_PX = 160;

function RunHistory() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter: RunHistoryFilter = {
    state: params.get("state") ?? "",
    flow: params.get("flow") ?? "",
    q: params.get("q") ?? "",
  };
  const [search, setSearch] = useState(filter.q);
  const mainRef = useRef<HTMLElement>(null);

  // Defaults stay out of the URL.
  const setFilter = (p: Partial<RunHistoryFilter>) => {
    const qs = new URLSearchParams(Object.entries({ ...filter, ...p }).filter(([, v]) => v));
    router.replace(qs.size ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // The search box commits to the URL once typing pauses, so each keystroke is not a fetch.
  useEffect(() => {
    if (search.trim() === filter.q) return;
    const id = setTimeout(() => setFilter({ q: search.trim() }), 300);
    return () => clearTimeout(id);
  });

  const historyQ = useRunHistory(filter);
  useLiveInvalidate("/api/dagent/runs/stream", RUN_HISTORY_PREFIX, false);
  const total = historyQ.data?.pages[0]?.total;
  // A run that starts between two page fetches shifts the rows down, so a row can arrive twice.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (historyQ.data?.pages ?? []).flatMap((p) => p.rows).filter((r) => !seen.has(r.id) && seen.add(r.id));
  }, [historyQ.data]);
  const now = useNow(rows.some((r) => ACTIVE.includes(r.state)));

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = historyQ;
  const nearBottom = () => {
    const el = mainRef.current;
    return !!el && el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_THRESHOLD_PX;
  };
  const loadMore = () => {
    if (hasNextPage && !isFetchingNextPage && nearBottom()) void fetchNextPage();
  };
  // A page that does not fill the screen leaves nothing to scroll, so keep loading until it does or the runs run out.
  useEffect(loadMore, [rows.length, hasNextPage, isFetchingNextPage]);

  return (
    <>
      <PageToolbar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticket id or title"
          aria-label="Search runs by ticket id or title"
          style={{ ...fieldInput(), flex: "1 1 200px", maxWidth: "340px", minWidth: "150px" }}
        />
        <div style={{ minWidth: "clamp(140px, 40vw, 180px)" }}>
          <SelectMenu value={filter.state} onChange={(v) => setFilter({ state: v })} options={[...HISTORY_STATES]} allLabel="State: All" ariaLabel="Filter by run state" />
        </div>
        <div style={{ minWidth: "clamp(140px, 40vw, 180px)" }}>
          <SelectMenu value={filter.flow} onChange={(v) => setFilter({ flow: v })} options={Object.values(HISTORY_FLOWS)} allLabel="Flow: All" ariaLabel="Filter by flow" />
        </div>
        <div style={{ flex: 1 }} />
        {total !== undefined ? (
          <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>
            {total} run{total === 1 ? "" : "s"}
          </span>
        ) : null}
      </PageToolbar>

      <main ref={mainRef} onScroll={loadMore} className="te-scroll te-main" style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", padding: "0 28px 20px", background: "var(--te-page-veil)" }}>
        {/* The top gap lives inside the scroll area, so the sticky header sits flush with its edge and rows never show above it. */}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "14px", paddingTop: "20px" }}>
          {historyQ.isPending ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
              <LoadingRing size={96} />
            </div>
          ) : historyQ.error ? (
            <div style={{ ...tintedCard("danger"), fontSize: FONT.base }}>{historyQ.error.message}</div>
          ) : !rows.length ? (
            <div style={{ ...card(), fontSize: FONT.base, color: COLORS.textMuted }}>
              {filter.state || filter.flow || filter.q ? "No run matches these filters." : "No D-Agent run yet. Runs started from Flow Runner show up here live."}
            </div>
          ) : (
            <div className="te-table-scroll" style={{ ...card({ padding: "0" }), overflowX: "clip" }}>
              <div className="te-table-body te-plan-table">
                <div className="te-plan-head" style={{ position: "sticky", top: 0, zIndex: 2, background: SURFACE.modal, display: "grid", gridTemplateColumns: GRID, gap: "10px", padding: "10px 14px", borderBottom: `1px solid ${COLORS.borderSubtle}`, fontSize: FONT.xs, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: COLORS.faint }}>
                  {COLUMNS.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                {rows.map((r) => (
                  <RunRow key={r.id} row={r} now={now} onOpen={() => router.push(`/workflow?run=${r.id}`)} />
                ))}
              </div>
            </div>
          )}
          {isFetchingNextPage || historyQ.isPlaceholderData ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
              <LoadingRing size={20} />
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}

// The header sits outside the Suspense boundary the search params need, so it hydrates with the page.
export default function RunHistoryPage() {
  return (
    <div style={{ position: "relative", height: "var(--te-app-h)", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text }}>
      <header className="te-page-header" style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "var(--te-header-bg)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="Run History" kicker="D-AGENT · EVERY RUN" icon={<path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2" />} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge />
      </header>
      <Suspense>
        <RunHistory />
      </Suspense>
    </div>
  );
}
