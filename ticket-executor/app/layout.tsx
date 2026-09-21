import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { BoltsProvider } from "./BoltsContext";
import RingAnimation from "./RingAnimation";
import SettingsProvider from "./SettingsProvider";
import { getOrCreateSetting } from "@/lib/settings";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space",
});
const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
});

// `appleWebApp` is what makes the Home Screen copy launch standalone on iOS,
// and standalone is the precondition for Web Push there: a web app opened in a
// Safari tab is never allowed to ask for notification permission. The manifest
// (app/manifest.ts) says the same thing for every other platform; iOS reads
// these meta tags as well, and disagreeing with itself is how an installed app
// ends up launching back into the browser.
export const metadata: Metadata = {
  title: "Ticket Executor",
  description: "Claude Code · Azure DevOps — run tickets from the UI",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "D-Agent", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

// `viewportFit: "cover"` is what makes env(safe-area-inset-*) resolve to
// anything but 0 — without it iOS letterboxes the page instead of handing the
// layer in globals.css the notch and home-indicator insets to pad around.
// `maximumScale` is deliberately absent: pinch-zoom stays available.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#06070A",
};

// The settings row is read here rather than left to a client fetch because two
// of the three effects have to be right on the *first* frame: the ring class
// below paints with the document, and the backdrop and the bolts start before
// any fetch could answer. Fetching them made the answer arrive late everywhere,
// and never arrive at all in a browser that had nothing cached to tide it over.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const row = await getOrCreateSetting();
  const settings = {
    animatedBackground: row.animatedBackground,
    clickEffects: row.clickEffects,
    ringAnimation: row.ringAnimation,
  };
  return (
    // Browser extensions add their own classes to this element — an
    // html-attribute-only mismatch React cannot see coming.
    <html
      lang="en"
      className={settings.ringAnimation ? undefined : "te-ring-static"}
      suppressHydrationWarning
    >
      <body
        className={`${spaceGrotesk.variable} ${hankenGrotesk.variable} ${jetbrainsMono.variable}`}
      >
        <SettingsProvider initial={settings}>
          <RingAnimation />
          <BoltsProvider>{children}</BoltsProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
