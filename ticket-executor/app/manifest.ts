import type { MetadataRoute } from "next";

/**
 * The Home Screen identity of the app.
 *
 * Not cosmetic: iOS grants Web Push only to a web app installed from a manifest
 * that declares `display: "standalone"`. Without this file, "Add to Home
 * Screen" produces a Safari bookmark — it looks identical on the Home Screen
 * and can never ask for notification permission.
 *
 * `start_url` is relative so the app keeps working under a deployment that
 * serves it from a sub-path (the container build sets `basePath: "/dagent"`).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ticket Executor",
    short_name: "D-Agent",
    description: "Claude Code · Azure DevOps — run tickets from the UI",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#06070A",
    theme_color: "#06070A",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
