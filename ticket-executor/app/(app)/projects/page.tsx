"use client";

import { motion } from "motion/react";
import { reveal } from "../../Motion";
import { useRouter } from "next/navigation";
import LoadingRing from "../../ticket-executor/LoadingRing";
import { COLORS, FONT, MOTION, displayText, ringBorder, tintedCard } from "@/lib/ui";
import { useBoltsContext } from "../../BoltsContext";
import ProviderBadge from "../ProviderBadge";
import PageHeading from "../PageHeading";
import NotificationCenter from "../NotificationCenter";
import { useProjects } from "../../queries";

type Project = { id: string; name: string; description?: string };

export default function ProjectsPage() {
  const router = useRouter();
  const { fireBoltFromEvent } = useBoltsContext();
  const projectsQuery = useProjects();
  const projects = (projectsQuery.data?.projects ?? []) as Project[];
  const loading = projectsQuery.isPending;
  const error = projectsQuery.data?.error || (projectsQuery.error as Error | null)?.message || "";
  const notice = projectsQuery.data?.notice ?? "";

  const openProject = (name: string, e: { clientX: number; clientY: number }) => {
    fireBoltFromEvent(e);
    router.push(`/ticket-execution?project=${encodeURIComponent(name)}`);
  };

  return (
    <div style={{ position: "relative", height: "var(--te-app-h)", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text, ["--accent" as string]: COLORS.accent }}>
      <header className="te-page-header" style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "var(--te-header-bg)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="Projects" kicker="D-AGENT · WORKSPACE" icon={<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge />
      </header>

      <main className="te-scroll te-main" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", padding: "28px", background: "var(--te-page-veil)" }}>
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
              <motion.button
                key={p.id}
                {...reveal({ index: i })}
                whileHover="hover"
                variants={{ hover: { y: -3 } }}
                whileTap={MOTION.tap}
                onClick={(e) => openProject(p.name, e)}
                style={{
                  textAlign: "left", cursor: "pointer", color: COLORS.text,
                  display: "flex", flexDirection: "column", gap: "12px",
                  padding: "20px", minHeight: "132px",
                  transition: "box-shadow .22s",
                  ...ringBorder({ fill: COLORS.panelBg, duration: 4.2 + (i % 5) * 0.3, shape: "none" }),
                  borderRadius: "14px",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 16px 38px -22px var(--accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
                  <div style={{ width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", ...ringBorder({ fill: "var(--te-btn-ghost-fill)", duration: 4.5, cornerPx: 8 }) }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                  </div>
                  <span style={{ ...displayText("heading"), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                </div>
                {p.description && (
                  <span style={{ fontSize: FONT.base, color: COLORS.textDim, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.description}</span>
                )}
                <div style={{ flex: 1 }} />
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: FONT.sm, fontWeight: 600, color: "var(--accent)" }}>
                  Open tickets
                  <motion.svg variants={{ hover: { x: 4 } }} transition={{ ease: MOTION.easeExpo, duration: 0.4 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></motion.svg>
                </span>
              </motion.button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
