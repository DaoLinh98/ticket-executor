"use client";

import { useEffect, useRef } from "react";
import { useBoltsContext } from "../BoltsContext";

// The spinning conic-gradient "energy core" — the ONE loading spinner shared
// by every loading state in the app, scaled via `size`. While mounted it also
// self-strikes with the app's lightning-bolt click effect (same one used for
// clicks) so every loading moment reads as "energy striking into the sphere",
// not just a static spin.
export default function LoadingRing({ size = 78 }: { size?: number }) {
  const scale = size / 78;
  const coreRef = useRef<HTMLDivElement>(null);
  const { fireBolt } = useBoltsContext();

  useEffect(() => {
    const jitter = Math.max(6, size * 0.33);
    const strike = () => {
      const el = coreRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2 + (Math.random() - 0.5) * jitter;
      const y = r.top + r.height / 2 + (Math.random() - 0.5) * jitter;
      fireBolt(x, y);
    };
    strike();
    const id = setInterval(strike, 420);
    return () => clearInterval(id);
  }, [fireBolt, size]);

  return (
    <div ref={coreRef} style={{ position: "relative", width: size + "px", height: size + "px" }}>
      <div style={{ position: "absolute", top: "50%", left: "50%", width: "78px", height: "78px", transform: `translate(-50%,-50%) scale(${scale})` }}>
        {/* outer spinning conic-gradient ring — same technique as the header pills */}
        <span
          style={{
            position: "absolute", inset: "-9px", borderRadius: "50%", padding: "2px",
            background: "conic-gradient(from var(--angle), transparent, var(--accent), transparent 55%)",
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor", maskComposite: "exclude",
            animation: "spinAngle 3.2s linear infinite",
          }}
        />
        {/* counter-rotating faceted ring for extra crispness */}
        <span
          style={{
            position: "absolute", inset: "9px", borderRadius: "50%", padding: "1.5px",
            background: "conic-gradient(from var(--angle), var(--accent) 0deg 8deg, transparent 8deg 42deg, var(--accent) 42deg 50deg, transparent 50deg 92deg, var(--accent) 92deg 100deg, transparent 100deg 180deg, var(--accent) 180deg 188deg, transparent 188deg 230deg, var(--accent) 230deg 238deg, transparent 238deg 360deg)",
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor", maskComposite: "exclude",
            animation: "spinAngle 2.1s linear infinite reverse",
            opacity: 0.8,
          }}
        />
        {/* shockwave rings releasing outward */}
        <span style={{ position: "absolute", inset: "6px", borderRadius: "50%", border: "1px solid rgba(251,114,80,.55)", animation: "ringPulse 1.8s ease-out infinite" }} />
        <span style={{ position: "absolute", inset: "6px", borderRadius: "50%", border: "1px solid rgba(251,114,80,.32)", animation: "ringPulse 1.8s ease-out .9s infinite" }} />
        {/* orbiting sparks */}
        <div style={{ position: "absolute", inset: 0, animation: "spin 2.3s linear infinite" }}>
          <span style={{ position: "absolute", top: "50%", left: "50%", width: "5px", height: "5px", borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 7px var(--accent)", transform: "translate(-50%,-50%) translateX(37px)" }} />
        </div>
        <div style={{ position: "absolute", inset: 0, animation: "spin 1.5s linear infinite reverse" }}>
          <span style={{ position: "absolute", top: "50%", left: "50%", width: "4px", height: "4px", borderRadius: "50%", background: "#FFD9BE", boxShadow: "0 0 6px #FFC15E", transform: "translate(-50%,-50%) translateX(29px)" }} />
        </div>
        {/* core sphere — off-center highlight for a sharper, dimensional look */}
        <span
          style={{
            position: "absolute", inset: "22px", borderRadius: "50%",
            background: "radial-gradient(circle at 34% 32%, #FFF3EA 0%, #FFC15E 14%, var(--accent) 40%, rgba(251,114,80,.65) 62%, transparent 80%)",
            boxShadow: "0 0 20px 2px rgba(251,114,80,.55)",
            animation: "corePulse 1.1s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );
}
