import type { Metadata } from "next";
import { Space_Grotesk, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { BoltsProvider } from "./BoltsContext";

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

export const metadata: Metadata = {
  title: "Ticket Executor",
  description: "Claude Code · Azure DevOps — run tickets from the UI",
};

// Paints the saved theme before the first frame. The setting lives in Postgres,
// so without this every load would render one frame of D-Agent orange before the
// fetch in AppTheme lands — a visible flash of the wrong brand. Runs blocking in
// <head>, reads the mirror AppTheme keeps, and touches nothing else.
const THEME_BOOTSTRAP = `try{if(localStorage.getItem('te:theme')==='emehub')document.documentElement.setAttribute('data-theme','emehub')}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${hankenGrotesk.variable} ${jetbrainsMono.variable}`}
      >
        <BoltsProvider>{children}</BoltsProvider>
      </body>
    </html>
  );
}
