"use client";

import { useCallback, useEffect, useState } from "react";
import { COLORS, FONT, ctaButtonStyle, sectionCaption, tintedCard } from "@/lib/ui";
import { useBoltsContext } from "../../BoltsContext";

/**
 * Enabling lock-screen notifications, from the device that will receive them.
 *
 * It is a device switch and not a `Setting`, which is why it is not part of the
 * page's one saved form: a subscription is issued by one browser to one
 * installed copy of the app, and storing "push: on" in the database would claim
 * something about a phone the server cannot see. What the server keeps is the
 * list of subscriptions; what this reads is whether *this* device is on it.
 *
 * Most of the component is the refusals, because on iOS every one of them looks
 * identical from a page that only shows a switch — nothing happens. The chain
 * has four links that fail silently and independently (not installed, no VAPID
 * keys, permission denied at the OS level, a service worker that never
 * registered), so each gets its own sentence.
 */

type State =
  | "loading"
  | "unsupported"      // the browser has no Push API at all
  | "needs-install"    // iOS Safari tab — push is only granted to the installed app
  | "unconfigured"     // the server has no VAPID keys
  | "denied"           // the OS refused, and only Settings can undo it
  | "off"
  | "on";

/** The applicationServerKey has to be raw bytes; VAPID keys travel as
 *  base64url. Browsers accept no other form of it. */
function toKeyBytes(base64url: string): ArrayBuffer {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return buffer;
}

/** iOS only grants push to a web app launched from the Home Screen. A Safari
 *  tab reports no standalone display mode, and `navigator.standalone` is the
 *  older signal iOS still sets. */
function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export default function PushNotifications() {
  const { fireBoltFromEvent } = useBoltsContext();
  const [state, setState] = useState<State>("loading");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const read = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState(isIOS() && !standalone() ? "needs-install" : "unsupported");
      return;
    }
    // Checked before the server call: on iOS the Push API is missing entirely
    // until the app is installed, so this branch is normally unreachable — but
    // a desktop browser in a tab is fine and must not be told to install.
    if (isIOS() && !standalone()) {
      setState("needs-install");
      return;
    }

    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();

    const r = await fetch(`/api/push?endpoint=${encodeURIComponent(sub?.endpoint ?? "")}`);
    const data = (await r.json()) as { enabled: boolean; publicKey: string; subscribed: boolean };
    setKey(data.publicKey);

    if (!data.enabled) return setState("unconfigured");
    if (Notification.permission === "denied") return setState("denied");
    // A subscription this server has never heard of is not "on": it would show
    // a switch that is on and a phone that stays silent.
    setState(sub && data.subscribed ? "on" : "off");
  }, []);

  useEffect(() => {
    void read().catch(() => setState("unsupported"));
  }, [read]);

  const enable = async () => {
    setBusy(true);
    setNote("");
    try {
      // Registered here rather than on page load: the worker exists only to
      // receive pushes, and asking every visitor's browser to install one for a
      // feature they have not turned on is work for nothing.
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Must be inside the click. iOS rejects a permission prompt that is not a
      // direct consequence of a tap, and rejects it silently.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const sub = await reg.pushManager.subscribe({
        // Mandatory everywhere and non-negotiable: a subscription that would
        // deliver a push without showing a notification is not issued.
        userVisibleOnly: true,
        applicationServerKey: toKeyBytes(key),
      });

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const r = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...json, label: navigator.userAgent.slice(0, 80) }),
      });
      if (!r.ok) throw new Error("The server refused the subscription");

      setState("on");
      setNote("This device will now be notified while the app is closed.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not enable notifications");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setNote("");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setNote("");
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      const data = (await r.json()) as { delivered?: number; error?: string };
      setNote(
        data.error
          ? data.error
          : data.delivered
            ? `Sent to ${data.delivered} device${data.delivered === 1 ? "" : "s"}.`
            : "No device is subscribed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const hint: React.CSSProperties = { fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.55 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div>
        <div style={sectionCaption()}>Lock screen</div>
        <div style={{ ...hint, marginTop: "6px" }}>
          The bell only updates while the app is open. Turn this on and the server sends
          each new notification to this device instead, so it arrives on the lock screen
          with the app closed.
        </div>
      </div>

      {state === "loading" && <div style={hint}>Checking this device…</div>}

      {state === "unsupported" && (
        <div style={tintedCard("warning", { padding: "11px 13px", radius: "10px" })}>
          <div style={{ fontSize: FONT.base, color: COLORS.text }}>
            This browser has no Push API — nothing to enable here.
          </div>
        </div>
      )}

      {state === "needs-install" && (
        <div style={tintedCard("warning", { padding: "11px 13px", radius: "10px" })}>
          <div style={{ fontSize: FONT.base, color: COLORS.text, lineHeight: 1.6 }}>
            Open this page in Safari, tap Share → <strong>Add to Home Screen</strong>, then
            open the app from that icon and come back here. iOS gives notifications only to
            an installed web app, never to a Safari tab — an icon added before this app had
            a manifest is a bookmark and has to be re-added.
          </div>
        </div>
      )}

      {state === "unconfigured" && (
        <div style={tintedCard("warning", { padding: "11px 13px", radius: "10px" })}>
          <div style={{ fontSize: FONT.base, color: COLORS.text, lineHeight: 1.6 }}>
            The server has no VAPID keys. Generate a pair with{" "}
            <code>npx web-push generate-vapid-keys</code>, put them in{" "}
            <code>VAPID_PUBLIC_KEY</code> / <code>VAPID_PRIVATE_KEY</code>, and restart.
          </div>
        </div>
      )}

      {state === "denied" && (
        <div style={tintedCard("danger", { padding: "11px 13px", radius: "10px" })}>
          <div style={{ fontSize: FONT.base, color: COLORS.text, lineHeight: 1.6 }}>
            Notifications are blocked for this app. The page cannot ask again — allow them
            in iOS Settings → Notifications → D-Agent, then reopen this page.
          </div>
        </div>
      )}

      {(state === "off" || state === "on") && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <button
            disabled={busy}
            onClick={(e) => { fireBoltFromEvent(e); void (state === "on" ? disable() : enable()); }}
            style={{ ...ctaButtonStyle(state === "on" ? "outline" : "primary", { height: "34px", cornerPx: 7 }), padding: "0 20px" }}
          >
            {state === "on" ? "Turn off on this device" : "Enable on this device"}
          </button>
          {state === "on" && (
            <button
              disabled={busy}
              onClick={(e) => { fireBoltFromEvent(e); void test(); }}
              style={{ ...ctaButtonStyle("ghost", { height: "34px", cornerPx: 7 }), padding: "0 16px" }}
            >
              Send a test
            </button>
          )}
        </div>
      )}

      {note && <div style={hint}>{note}</div>}
    </div>
  );
}
