import webpush from "web-push";
import { prisma } from "@/lib/prisma";

/**
 * Web Push — the only way a notification reaches a locked iPhone.
 *
 * The bell polls while a tab is open, which is the whole of its reach: iOS
 * suspends a web app the moment it leaves the foreground and runs no JavaScript
 * of it again until somebody taps the icon. A notification that has to be
 * *fetched* therefore cannot arrive on a lock screen by construction. Push
 * inverts it — this server hands an already-composed message to Apple's push
 * service, which wakes the installed app's service worker just long enough to
 * display it.
 *
 * What iOS demands, none of it optional (16.4+):
 *   - the app installed to the Home Screen from a manifest with `display:
 *     standalone` — Safari tabs get no push at all;
 *   - a service worker registered at a scope covering the app;
 *   - `Notification.requestPermission()` called from a real tap inside the
 *     installed app;
 *   - a stable HTTPS origin, because a subscription is issued against one
 *     origin and dies with it.
 *
 * VAPID identifies this server to the push service. The key pair is generated
 * once (`npx web-push generate-vapid-keys`) and lives in the environment: the
 * public half is handed to the browser at subscribe time, the private half
 * signs every send and never leaves the server. Rotating it invalidates every
 * stored subscription, which is why it is configuration and not a constant.
 */

/** What the service worker is handed. Kept small on purpose — a push payload
 *  has a hard size limit and everything here is already on screen once the app
 *  opens; this is a headline and an address, not a copy of the notification. */
export type PushPayload = {
  title: string;
  body: string;
  /** Where a tap should land, as an app-relative path. */
  url: string;
  /** Collapses replacements of the same notification on the device, so a run
   *  that reports twice does not stack two banners. */
  tag: string;
};

function keys(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!publicKey || !privateKey) return null;
  // The push service requires a contact for the sender. mailto: is the only
  // form every service accepts; the address is never shown to the user.
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:admin@example.com";
  return { publicKey, privateKey, subject };
}

/** Configured? Everything else in this module is a no-op when it is not, so the
 *  app runs unchanged on a machine that never set the keys. */
export function pushEnabled(): boolean {
  return keys() !== null;
}

/** The public half, for the browser's `subscribe()` call. "" when unconfigured. */
export function publicKey(): string {
  return keys()?.publicKey ?? "";
}

let configured = false;

function configure(): boolean {
  const k = keys();
  if (!k) return false;
  if (!configured) {
    webpush.setVapidDetails(k.subject, k.publicKey, k.privateKey);
    configured = true;
  }
  return true;
}

/**
 * Send one payload to every subscribed device.
 *
 * Returns how many actually took it. A 404 or 410 from the push service is the
 * device saying the subscription is gone for good — uninstalled app, cleared
 * site data, revoked permission — so the row is deleted rather than retried;
 * any other failure is the network or the service having a bad minute and is
 * left alone, because the subscription is still valid.
 */
export async function pushToAll(payload: PushPayload): Promise<number> {
  if (!configure()) return 0;

  const subs = await prisma.pushSubscription.findMany();
  if (!subs.length) return 0;

  const body = JSON.stringify(payload);
  let delivered = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        delivered++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        } else {
          console.error("[ticket-executor] push send failed:", status ?? e);
        }
      }
    }),
  );

  return delivered;
}
