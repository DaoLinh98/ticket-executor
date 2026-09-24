import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import AppReactor from "./AppReactor";
import NotificationsProvider from "./NotificationsProvider";
import MobileNavProvider from "./MobileNav";
import MobileNavToggle from "./MobileNavToggle";
import { COLORS } from "@/lib/ui";
import { authDisabled } from "@/lib/auth";

// Shared authenticated shell: one persistent reactor backdrop + sidebar
// alongside the active page. Auth is enforced upstream in proxy.ts, so no gate
// is needed here.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <NotificationsProvider>
      <MobileNavProvider>
        <div style={{ position: "relative", display: "flex", height: "var(--te-app-h)", width: "100%", overflow: "hidden", ["--accent" as string]: COLORS.accent }}>
          <AppReactor />
          <Sidebar authEnabled={!authDisabled()} />
          <MobileNavToggle />
          <div style={{ position: "relative", zIndex: 1, flex: 1, minWidth: 0, height: "var(--te-app-h)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {children}
          </div>
        </div>
      </MobileNavProvider>
    </NotificationsProvider>
  );
}
