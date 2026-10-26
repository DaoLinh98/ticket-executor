"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { COLORS, FONT, fieldInput, fieldLabel } from "@/lib/ui";
import ActionButton from "../my-sprint/ActionButton";
import RebuildPreviewDialog from "../my-sprint/RebuildPreviewDialog";
import { PLAN_KEY, fetchPlan, type PlanResponse, type RebuildPreview } from "../my-sprint/model";
import { useToast } from "../ToastProvider";

const FIELDS = [
  ["pointsPerDay", "POINTS / DAY", "decimal"],
  ["hoursPerDay", "HOURS / DAY", "decimal"],
  ["maxTicketsPerDay", "MAX TICKETS / DAY (0 = NO LIMIT)", "numeric"],
] as const;

type Draft = Record<(typeof FIELDS)[number][0], string>;

const send = async (body: unknown, method: string) => {
  const r = await fetch("/api/my-sprint/plan", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "The request failed.");
  return d;
};

// The Flow Runner's pacing and reviewers. They belong to the stored plan, not to
// the app settings, so this pane saves on its own (Apply & rebuild / Save
// reviewers) rather than through the page's Save changes.
export default function FlowRunnerSettings() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const planQuery = useQuery({ queryKey: PLAN_KEY, queryFn: fetchPlan, refetchOnMount: "always" });
  const stored = planQuery.data?.plan ?? null;

  const saved: Draft = {
    pointsPerDay: String(stored?.pointsPerDay ?? ""),
    hoursPerDay: String(stored?.hoursPerDay ?? ""),
    maxTicketsPerDay: String(stored?.maxTicketsPerDay ?? 0),
  };
  const [draft, setDraft] = useState<Draft>(saved);
  const savedReviewers = (stored?.reviewers ?? []).join(", ");
  const [reviewers, setReviewers] = useState(savedReviewers);
  const [preview, setPreview] = useState<RebuildPreview | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const savedKey = JSON.stringify(saved);
  useEffect(() => setDraft(JSON.parse(savedKey)), [savedKey]);
  useEffect(() => setReviewers(savedReviewers), [savedReviewers]);

  const parsedReviewers = reviewers.split(/[,;\n]/).map((r) => r.trim()).filter(Boolean);
  const valid = Number(draft.pointsPerDay) > 0 && Number(draft.hoursPerDay) > 0 && Number(draft.maxTicketsPerDay) >= 0;
  const changed = !!stored && FIELDS.some(([f]) => Number(draft[f]) !== Number(saved[f]));
  const config = () => ({
    pointsPerDay: Number(draft.pointsPerDay) || undefined,
    hoursPerDay: Number(draft.hoursPerDay) || undefined,
    maxTicketsPerDay: Number(draft.maxTicketsPerDay) || 0,
  });

  const setPlan = (plan: PlanResponse["plan"]) =>
    queryClient.setQueryData<PlanResponse>(PLAN_KEY, (old) => ({ events: [], drafts: [], costs: {}, ...old, plan }));

  const run = useMutation({
    mutationFn: async ({ fn }: { key: string; fn: () => Promise<void> }) => fn(),
    onMutate: ({ key }) => setBusy((b) => new Set(b).add(key)),
    onError: (e) => showToast(e instanceof Error ? e.message : String(e), "error"),
    onSettled: (_d, _e, { key }) => setBusy((b) => { const n = new Set(b); n.delete(key); return n; }),
  });
  const act = (key: string, fn: () => Promise<void>) => run.mutateAsync({ key, fn }).catch(() => undefined);

  const rebuild = async () => {
    const d = await send(config(), "POST");
    setPlan(d.plan);
    showToast("Plan rebuilt.");
    if (d.warning) showToast(d.warning, "warning");
    void queryClient.invalidateQueries({ queryKey: ["my-sprint"], exact: true });
  };

  const apply = () =>
    act("plan", async () => {
      const d = await send({ ...config(), dryRun: true }, "POST");
      const p: RebuildPreview = d.preview;
      if (p.added.length || p.moved.length || p.redated.length || p.claimChanged.length || p.overflowPoints > 0) {
        setPreview(p);
        return;
      }
      await rebuild();
    });

  const saveReviewers = () =>
    act("reviewers", async () => {
      const d = await send({ id: stored?.id, reviewers: parsedReviewers }, "PATCH");
      setPlan(d.plan);
      showToast("Reviewers saved.");
    });

  if (planQuery.isPending) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.55 }}>
        {stored
          ? "How the Flow Runner paces a sprint and who reviews finished work. Changing the pacing rebuilds the plan."
          : "No plan yet. Build one on Flow Runner first — these settings belong to it."}
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
        {FIELDS.map(([field, label, mode]) => (
          <label key={field} style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 140px", minWidth: 0 }}>
            <span style={{ ...fieldLabel(), fontSize: FONT.sm }}>{label}</span>
            <input
              value={draft[field]}
              onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
              inputMode={mode}
              autoComplete="off"
              disabled={!stored}
              style={{ ...fieldInput(), width: "100%", boxSizing: "border-box" }}
            />
          </label>
        ))}
        <ActionButton tall label="Apply & rebuild" variant="outline" onClick={apply} busy={busy.has("plan")} disabled={!changed || !valid} />
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 260px", minWidth: 0 }}>
          <span style={{ ...fieldLabel(), fontSize: FONT.sm }}>REVIEWERS (COMMA-SEPARATED)</span>
          <input
            value={reviewers}
            onChange={(e) => setReviewers(e.target.value)}
            placeholder="name@company.com, other@company.com"
            autoComplete="off"
            spellCheck={false}
            disabled={!stored}
            style={{ ...fieldInput(), width: "100%", boxSizing: "border-box" }}
          />
        </label>
        <ActionButton tall label="Save reviewers" variant="outline" onClick={saveReviewers} busy={busy.has("reviewers")} disabled={!stored || parsedReviewers.join(", ") === savedReviewers} />
      </div>
      {preview && (
        <RebuildPreviewDialog
          preview={preview}
          busy={busy.has("plan")}
          onConfirm={() => act("plan", async () => { await rebuild(); setPreview(null); })}
          onCancel={() => setPreview(null)}
        />
      )}
    </div>
  );
}
