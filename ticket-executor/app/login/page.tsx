"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { COLORS, card, clipCorner, ctaButtonStyle, ringBorder } from "@/lib/ui";

const fieldInputStyle: CSSProperties = {
  height: "40px", padding: "0 13px", border: `1px solid ${COLORS.border}`, borderRadius: "9px",
  background: "#0E1015", color: COLORS.text, fontFamily: "var(--font-mono), monospace",
  fontSize: "13px", outline: "none", width: "100%",
};
const labelStyle: CSSProperties = {
  fontSize: "11px", letterSpacing: ".1em", fontWeight: 600, color: COLORS.textDim,
};

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, remember }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Login failed");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        ["--accent" as string]: COLORS.accent,
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#06070A", padding: "24px",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          ...card({ padding: "30px 28px", radius: "16px" }),
          width: "100%", maxWidth: "380px",
          display: "flex", flexDirection: "column", gap: "20px",
          animation: "slideIn .22s ease-out both",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 22px -8px var(--accent)", ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3.4 }) }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M8 5l8 7-8 7" stroke="#0B0C10" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={{ fontFamily: "var(--font-space), sans-serif", fontWeight: 700, fontSize: "16px", color: COLORS.text }}>D-Agent</span>
            <span style={{ fontSize: "10px", letterSpacing: ".16em", fontWeight: 600, marginTop: "4px", color: COLORS.textDim }}>SIGN IN</span>
          </div>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={labelStyle}>ACCESS PASSWORD</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••••••"
            autoFocus
            style={fieldInputStyle}
          />
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "9px", cursor: "pointer", fontSize: "12.5px", color: COLORS.textDim }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            style={{ width: "15px", height: "15px", accentColor: COLORS.accent, cursor: "pointer" }}
          />
          Remember me for 30 days
        </label>

        {error && (
          <div style={{ fontSize: "12.5px", color: COLORS.danger }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          style={{ ...ctaButtonStyle("primary", { height: "40px" }), justifyContent: "center", opacity: busy || password.length === 0 ? 0.6 : 1, clipPath: clipCorner(8) }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
