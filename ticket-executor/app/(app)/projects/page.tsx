"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LoadingRing from "../../ticket-executor/LoadingRing";
import { COLORS, FONT, ringBorder, tintedCard } from "@/lib/ui";
import { useBoltsContext } from "../../BoltsContext";
import ProviderBadge from "../ProviderBadge";
import PageHeading from "../PageHeading";
import NotificationCenter from "../NotificationCenter";
import { CONNECTION_CHANGED_EVENT } from "../../connectionEvents";

type Project = { id: string; name: string; description?: string };

export default function ProjectsPage() {
  const router = useRouter();
  const { fireBoltFromEvent } = useBoltsContext();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      // No provider param: the route resolves it from the stored setting and
      // echoes it back. Asking /api/settings first only to fill in a value the
      // server already holds made this page two sequential round-trips.
      const r = await fetch("/api/projects");
      const data = await r.json();
      if (data.error) setError(data.error);
      if (data.notice) setNotice(data.notice);
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The organization switched in the header — these projects belong to the old
  // one.
  useEffect(() => {
    const onChanged = () => { load(); };
    window.addEventListener(CONNECTION_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONNECTION_CHANGED_EVENT, onChanged);
  }, [load]);

  const openProject = (name: string, e: { clientX: number; clientY: number }) => {
    fireBoltFromEvent(e);
    router.push(`/ticket-execution?project=${encodeURIComponent(name)}`);
  };

  return (
    <div style={{ position: "relative", height: "var(--te-app-h)", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      <header className="te-page-header" style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(14,17,23,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="Projects" kicker="D-AGENT · WORKSPACE" icon={<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge />
      </header>

      <main className="te-scroll te-main" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", padding: "28px", background: "linear-gradient(110deg,rgba(6,7,10,.5) 0%,rgba(6,7,10,.22) 52%,rgba(6,7,10,0) 100%)" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: "80px" }}><LoadingRing size={120} /></div>
        ) : error ? (
          <div style={{ maxWidth: "560px", margin: "40px auto 0", ...tintedCard("danger") }}>
            <div style={{ fontSize: FONT.base, color: COLORS.danger, fontWeight: 600 }}>{error}</div>
          </div>
        ) : projects.length === 0 ? (
          <div style={{ maxWidth: "560px", margin: "40px auto 0", ...tintedCard("warning") }}>
            <div style={{ fontSize: FONT.base, color: COLORS.warning, fontWeight: 600 }}>{notice || "No projects found. Connect a provider in Settings."}</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "18px", maxWidth: "1200px", margin: "0 auto" }}>
            {projects.map((p, i) => (
              <button
                key={p.id}
                onClick={(e) => openProject(p.name, e)}
                style={{
                  textAlign: "left", cursor: "pointer", color: COLORS.text,
                  display: "flex", flexDirection: "column", gap: "12px",
                  padding: "20px", minHeight: "132px",
                  transition: "transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s",
                  animation: "fadeUp .45s both", animationDelay: `${i * 45}ms`,
                  ...ringBorder({ fill: COLORS.panelBg, duration: 4.2 + (i % 5) * 0.3, shape: "none" }),
                  borderRadius: "14px",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 16px 38px -22px var(--accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
                  <div style={{ width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", ...ringBorder({ fill: "#1A1E25", duration: 4.5, cornerPx: 8 }) }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                  </div>
                  <span style={{ fontFamily: "var(--font-space), sans-serif", fontSize: FONT.lg, fontWeight: 700, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                </div>
                {p.description && (
                  <span style={{ fontSize: FONT.base, color: COLORS.textDim, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.description}</span>
                )}
                <div style={{ flex: 1 }} />
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: FONT.sm, fontWeight: 600, color: "var(--accent)" }}>
                  Open tickets
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                </span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
