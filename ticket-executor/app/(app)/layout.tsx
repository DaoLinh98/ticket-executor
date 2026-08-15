import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import AppReactor from "./AppReactor";
import AppTheme, { AppBlooms } from "./AppTheme";
import { COLORS } from "@/lib/ui";

// Shared authenticated shell: one persistent reactor backdrop + sidebar
// alongside the active page. Auth is enforced upstream in proxy.ts, so no gate
// is needed here.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "relative", display: "flex", height: "100vh", width: "100%", overflow: "hidden", ["--accent" as string]: COLORS.accent }}>
      <AppTheme />
      <AppBlooms />
      <AppReactor />
      <Sidebar />
      <div style={{ position: "relative", zIndex: 1, flex: 1, minWidth: 0, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
