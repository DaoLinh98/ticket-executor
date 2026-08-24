"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Reactor from "../Reactor";
import { COLORS, FONT, ctaButtonStyle, logoText, modalShellStyle, ringBorder, tintedCard } from "@/lib/ui";
import { useBoltsContext } from "../BoltsContext";
import { mintHubToken } from "../hubSession";

const fieldInputStyle: CSSProperties = {
  height: "42px", padding: "0 40px 0 13px", border: `1px solid ${COLORS.border}`, borderRadius: "9px",
  background: "#0E1015", color: COLORS.text, fontFamily: "var(--font-mono), monospace",
  fontSize: FONT.base, outline: "none", width: "100%", transition: "border-color .18s, box-shadow .18s",
};
const labelStyle: CSSProperties = {
  fontSize: FONT.xs, letterSpacing: ".1em", fontWeight: 600, color: COLORS.textDim,
};

export default function LoginPage() {
  const router = useRouter();
  const { fireBoltFromEvent } = useBoltsContext();
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [focused, setFocused] = useState(false);
  const [sso, setSso] = useState(true);

  // EmeHub single sign-on (emehub `docs/DAGENT-HANDOFF.md` § 4).
  //
  // Pressing Launch at the hub used to land here, at a password form, because
  // nothing exchanged the hub session for a local one. This is that exchange:
  // mint a token in the browser — the only place it can be minted, since it
  // authenticates with the hub's HttpOnly cookie (emehub ADR 0008) — and hand it
  // to our own API, which verifies it with the hub and sets the session cookie.
  //
  // Every failure is silent and falls through to the password form on purpose.
  // Not signed in at the hub, no hub configured, hub down: none of those are
  // this page's problem to report, and all of them leave the user with the one
  // thing that still works. The form is what they see if this does not finish.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/hub/token", { cache: "no-store" });
        if (!r.ok) return;
        const state = (await r.json()) as { hubUrl?: string };
        if (!state.hubUrl) return;

        const minted = await mintHubToken(state.hubUrl);
        if ("error" in minted) return;

        const handed = await fetch("/api/hub/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hubToken: minted.token, expiresIn: minted.expiresIn }),
        });
        if (!handed.ok) return;
        const body = (await handed.json().catch(() => ({}))) as { sessionGranted?: boolean };
        if (!body.sessionGranted || cancelled) return;

        router.replace("/");
        router.refresh();
      } catch {
        /* fall through to the password form */
      } finally {
        if (!cancelled) setSso(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

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
        position: "relative", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#06070A", padding: "24px", overflow: "hidden",
      }}
    >
      <Reactor accent={COLORS.accent} />
      <div
        style={{
          position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
          background: "repeating-linear-gradient(0deg,rgba(255,255,255,.016) 0px,rgba(255,255,255,.016) 1px,transparent 1px,transparent 3px)",
        }}
      />

      <form
        onSubmit={onSubmit}
        style={{
          ...modalShellStyle({ radius: "18px" }),
          position: "relative", zIndex: 1,
          padding: "34px 30px", width: "100%", maxWidth: "380px",
          display: "flex", flexDirection: "column", gap: "22px",
          boxShadow: "0 40px 90px -30px #000, 0 0 60px -28px var(--accent)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "13px", animation: "fadeUp .45s both" }}>
          <div style={{ width: "38px", height: "38px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 22px -8px var(--accent)", ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3.4 }) }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M8 5l8 7-8 7" stroke="#0B0C10" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={logoText(FONT.xl)}>D-Agent</span>
            <span style={{ fontSize: FONT.xs, letterSpacing: ".16em", fontWeight: 600, marginTop: "5px", background: "linear-gradient(90deg,#5B6273 0%,#5B6273 30%,#FFD9BE 45%,var(--accent) 52%,#5B6273 65%,#5B6273 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}>SIGN IN TO CONTINUE</span>
          </div>
        </div>

        {sso && (
          <div style={{ ...labelStyle, color: COLORS.textDim, animation: "fadeUp .3s both" }}>
            CHECKING EMEHUB SIGN-IN…
          </div>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: "8px", animation: "fadeUp .45s both", animationDelay: "60ms" }}>
          <span style={labelStyle}>ACCESS PASSWORD</span>
          <div style={{ position: "relative" }}>
            <input
              type={reveal ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="••••••••••••••••"
              autoFocus
              style={{
                ...fieldInputStyle,
                borderColor: focused ? "var(--accent)" : COLORS.border,
                boxShadow: focused ? "0 0 0 3px rgba(251,114,80,.14)" : "none",
              }}
            />
            <button
              type="button"
              onClick={(e) => { fireBoltFromEvent(e); setReveal((v) => !v); }}
              tabIndex={-1}
              aria-label={reveal ? "Hide password" : "Show password"}
              style={{
                position: "absolute", right: "4px", top: "50%", transform: "translateY(-50%)",
                width: "30px", height: "30px", display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "none", cursor: "pointer", color: COLORS.textDim,
              }}
            >
              {reveal ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.5 5.4A9.6 9.6 0 0112 5c5 0 9 4 10 7-.4 1.2-1.1 2.5-2.1 3.6M6.7 6.7C4.6 8 3.2 9.9 2 12c1 3 5 7 10 7 1.3 0 2.5-.2 3.6-.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M2 12c1-3 5-7 10-7s9 4 10 7c-1 3-5 7-10 7s-9-4-10-7z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" /></svg>
              )}
            </button>
          </div>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "9px", cursor: "pointer", fontSize: FONT.base, color: COLORS.textDim, animation: "fadeUp .45s both", animationDelay: "120ms" }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            style={{ width: "15px", height: "15px", accentColor: COLORS.accent, cursor: "pointer" }}
          />
          Remember me for 30 days
        </label>

        {error && (
          <div style={{ ...tintedCard("danger", { padding: "10px 13px", radius: "9px" }), fontSize: FONT.base, color: "#FFB3AD", animation: "fadeUp .3s both" }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          onClick={(e) => fireBoltFromEvent(e)}
          disabled={busy || password.length === 0}
          style={{
            ...ctaButtonStyle("primary", { height: "42px" }),
            ...ringBorder({
              fill: COLORS.accent, variant: "filled", cornerPx: 8,
              extraAnimation: "fadeUp .45s both", extraAnimationDelay: "170ms",
            }),
            justifyContent: "center",
            opacity: busy || password.length === 0 ? 0.6 : 1,
            cursor: busy || password.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
