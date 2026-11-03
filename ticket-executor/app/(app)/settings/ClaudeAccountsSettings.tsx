"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { COLORS, FONT, card, fieldInput, fieldLabel, pill, tintedCard, toneTint } from "@/lib/ui";
import { CLAUDE_EXPIRY_WARNING_MS } from "@/lib/notifications";
import type { ClaudeCredentialView } from "@/lib/claudeAccounts";
import ActionButton from "../my-sprint/ActionButton";
import LoadingRing from "../../ticket-executor/LoadingRing";
import { useToast } from "../ToastProvider";
import { CLAUDE_CREDENTIALS_KEY, useClaudeCredentials } from "../../queries";

/** `token` is what is sent: a pasted setup-token, or the dropped file's whole text (the server keeps only its access token). */
type Editor = { id: string; label: string; token: string; fileName: string; expiresAt: string | null };

const NEW_EDITOR = { token: "", fileName: "", expiresAt: null };
const MAX_FILE_BYTES = 64 * 1024;

const STATUS: Record<ClaudeCredentialView["status"], { label: string; color: string }> = {
  ready: { label: "READY", color: COLORS.success },
  limited: { label: "OUT OF QUOTA", color: COLORS.warning },
  invalid: { label: "REJECTED", color: COLORS.danger },
  expired: { label: "EXPIRED", color: COLORS.danger },
  disabled: { label: "OFF", color: COLORS.faint },
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

const send = async (method: string, body?: unknown, query = "") => {
  const r = await fetch(`/api/claude-credentials${query}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(d.credentials)) throw new Error(d.error || "The request failed.");
  return d as { credentials: ClaudeCredentialView[] };
};

// Claude accounts the CLI may run as instead of this machine's own login. Saves
// on its own (like Flow Runner), not through the page's Save changes: a token is
// a secret written once, never part of the settings form.
export default function ClaudeAccountsSettings() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const query = useClaudeCredentials();
  const list = query.data?.credentials ?? [];
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Checked here only to fail fast with a clear message; the server parses it again and is the one that decides.
  const loadFile = async (file: File) => {
    if (!editor) return;
    if (file.size > MAX_FILE_BYTES) { showToast("That file is too large to be a .credentials.json.", "error"); return; }
    const text = await file.text();
    let oauth: { accessToken?: unknown; expiresAt?: unknown } | undefined;
    try {
      oauth = (JSON.parse(text) as { claudeAiOauth?: typeof oauth }).claudeAiOauth;
    } catch {
      showToast(`${file.name} is not valid JSON.`, "error");
      return;
    }
    if (typeof oauth?.accessToken !== "string" || !oauth.accessToken) {
      showToast(`${file.name} has no claudeAiOauth.accessToken — is it a Claude .credentials.json?`, "error");
      return;
    }
    const ms = Number(oauth.expiresAt);
    const expiresAt = Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) showToast("The access token in that file has already expired — log in again on that machine first.", "warning");
    setEditor({ ...editor, token: text, fileName: file.name, expiresAt });
  };

  const run = useMutation({
    mutationFn: async ({ fn }: { key: string; fn: () => Promise<{ credentials: ClaudeCredentialView[] }>; done: string }) => fn(),
    onMutate: ({ key }) => setBusy(key),
    onSuccess: (d, { done }) => {
      queryClient.setQueryData(CLAUDE_CREDENTIALS_KEY, d);
      if (done) showToast(done);
    },
    onError: (e) => showToast(e instanceof Error ? e.message : String(e), "error"),
    onSettled: () => setBusy(""),
  });
  const act = (key: string, done: string, fn: () => Promise<{ credentials: ClaudeCredentialView[] }>) =>
    run.mutateAsync({ key, fn, done }).then(() => true, () => false);

  const save = async () => {
    if (!editor) return;
    if (!editor.id && !editor.token.trim()) { showToast("Drop a .credentials.json or paste a setup-token first.", "warning"); return; }
    const ok = await act("save", editor.id ? "Credential saved." : "Credential added.", () =>
      send("POST", { id: editor.id || undefined, label: editor.label, token: editor.token }));
    if (ok) setEditor(null);
  };

  const hint = { fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.55 };

  const row = (c: ClaudeCredentialView, i: number) => {
    const s = STATUS[c.status];
    const expiringSoon = c.status === "ready" && c.expiresAt && Date.parse(c.expiresAt) - Date.now() <= CLAUDE_EXPIRY_WARNING_MS;
    const meta = [
      c.status === "limited" && `Out of quota until ${when(c.limitedUntil)}`,
      c.status === "invalid" && `Rejected ${when(c.invalidAt)} — paste a new token`,
      c.expiresAt && (c.status === "expired" ? `Expired ${when(c.expiresAt)} — paste a new token` : `Expires ${when(c.expiresAt)}`),
      c.lastUsedAt && `Last used ${when(c.lastUsedAt)}`,
    ].filter(Boolean) as string[];
    return (
      <div key={c.id} style={{ ...card({ padding: "12px 14px" }), display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "9px", minWidth: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: FONT.sm, color: COLORS.textDim, fontWeight: 700 }}>{i + 1}.</span>
          <span style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.label || `Credential #${i + 1}`}
          </span>
          <span style={pill({ color: s.color, size: "xs", weight: 700 })}>{s.label}</span>
          {expiringSoon && <span style={pill({ color: COLORS.warning, size: "xs", weight: 700 })}>EXPIRES SOON</span>}
        </div>
        {meta.map((m) => <span key={m} style={{ fontSize: FONT.sm, color: COLORS.textDim }}>{m}</span>)}
        {c.lastError && c.status !== "ready" && (
          <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, overflowWrap: "anywhere" }}>{c.lastError}</span>
        )}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <ActionButton label="Up" variant="ghost" disabled={i === 0} busy={busy === `up:${c.id}`} onClick={() => act(`up:${c.id}`, "", () => send("PATCH", { id: c.id, move: -1 }))} />
          <ActionButton label="Down" variant="ghost" disabled={i === list.length - 1} busy={busy === `down:${c.id}`} onClick={() => act(`down:${c.id}`, "", () => send("PATCH", { id: c.id, move: 1 }))} />
          <ActionButton label={c.enabled ? "Turn off" : "Turn on"} variant="ghost" busy={busy === `toggle:${c.id}`}
            onClick={() => act(`toggle:${c.id}`, c.enabled ? "Credential turned off." : "Credential turned on.", () => send("POST", { id: c.id, label: c.label, enabled: !c.enabled }))} />
          <ActionButton label="Edit / new token" variant="ghost" onClick={() => setEditor({ id: c.id, label: c.label, ...NEW_EDITOR })} />
          <ActionButton label="Remove" variant="ghost" busy={busy === `del:${c.id}`}
            onClick={() => act(`del:${c.id}`, "Credential removed.", () => send("DELETE", undefined, `?id=${encodeURIComponent(c.id)}`))} />
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <span style={hint}>
        Runs use these Claude accounts in order, before this machine&apos;s own login. When one is out of quota or its
        token is rejected, the turn is re-run at once on the next one; this machine&apos;s login is always the last resort.
      </span>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <span style={fieldLabel()}>CLAUDE ACCOUNTS</span>
          <ActionButton label="Add credential" variant="outline" onClick={() => setEditor({ id: "", label: "", ...NEW_EDITOR })} />
        </div>
        {query.isPending ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "20px" }}><LoadingRing size={40} /></div>
        ) : query.isError ? (
          <div style={tintedCard("danger", { padding: "12px 14px" })}>
            <span style={{ fontSize: FONT.base, color: COLORS.danger }}>{query.error instanceof Error ? query.error.message : "Could not load."}</span>
          </div>
        ) : (
          list.map(row)
        )}
        <div style={{ ...card({ padding: "12px 14px" }), display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text }}>{list.length + 1}. This machine&apos;s login</span>
          <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>The account in ~/.claude — used when no credential above is ready.</span>
        </div>
      </div>

      {editor && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", ...card({ padding: "16px", background: "var(--te-inset-bg)" }) }}>
          <span style={fieldLabel()}>{editor.id ? "EDIT CREDENTIAL" : "NEW CREDENTIAL"}</span>
          <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={fieldLabel()}>NAME (OPTIONAL)</span>
            <input value={editor.label} onChange={(e) => setEditor({ ...editor, label: e.target.value })} placeholder="Team Max account" autoComplete="off" style={fieldInput()} />
          </label>
          <span style={fieldLabel()}>{editor.id ? "NEW CREDENTIAL FILE (LEAVE EMPTY TO KEEP THE SAVED ONE)" : "CREDENTIAL FILE"}</span>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ""; }} />
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.current?.click(); } }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void loadFile(f); }}
            style={{
              ...(editor.fileName ? tintedCard("success", { padding: "18px 14px" }) : card({ padding: "18px 14px", background: "var(--te-field-bg)" })),
              minHeight: "88px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px",
              textAlign: "center", cursor: "pointer",
              // The whole shorthand, not border longhands over card()'s `border` (a React re-render styling bug).
              border: `1.5px dashed ${dragging ? COLORS.accent : editor.fileName ? toneTint(COLORS.success, 55) : COLORS.border}`,
            }}
          >
            {editor.fileName ? (
              <>
                <span style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.text, overflowWrap: "anywhere" }}>✓ {editor.fileName}</span>
                <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>
                  {editor.expiresAt ? `Access token expires ${when(editor.expiresAt)}` : "No expiry in the file"} · tap to choose another
                </span>
              </>
            ) : (
              <>
                <span style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.text }}>Drop .credentials.json here</span>
                <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>or tap to choose the file (~/.claude/.credentials.json)</span>
              </>
            )}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={fieldLabel()}>OR PASTE A SETUP-TOKEN</span>
            <input
              type="password"
              value={editor.fileName ? "" : editor.token}
              onChange={(e) => setEditor({ ...editor, token: e.target.value, fileName: "", expiresAt: null })}
              placeholder="sk-ant-oat01-…"
              autoComplete="new-password"
              spellCheck={false}
              style={fieldInput()}
            />
          </label>
          <span style={hint}>
            Only the file&apos;s access token is kept — its refresh token is not, because using it here would log the
            original machine out. That access token lasts hours, and the bell asks for a new file when it expires.
            For a credential that lasts about a year, run <code>claude setup-token</code> and paste the token instead.
          </span>
          <div style={{ display: "flex", gap: "11px", flexWrap: "wrap" }}>
            <ActionButton label={editor.id ? "Save credential" : "Add credential"} variant="outline" busy={busy === "save"} onClick={save} />
            <ActionButton label="Cancel" variant="ghost" onClick={() => setEditor(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
