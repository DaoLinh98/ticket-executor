import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  HubNotConfigured, HubRejected, HubSignedOut, HubUnreachable,
  hubSessionState, hubUrl, listHubConnections,
} from "@/lib/hub";

export const dynamic = "force-dynamic";

// GET /api/hub — what the Settings page needs to render the EmeHub section.
//
// **The connection list is read live from the hub, not from a local table.**
// There is no local table any more: hub mode routes provider calls through the
// hub rather than copying its configuration, so the catalogue this offers as a
// picker is whatever the hub says right now. A list that could be stale is a
// list that can offer a connection the hub has already deleted.
//
// Four failures, four different answers. INTEGRATION.md §5 is explicit that "no
// hub configured", "the hub is down" and "you are signed out" must not render
// the same screen — so this reports which one it was, and the page decides
// whether to show a Connect button, a retry, or a link to sign in at the hub.
export async function GET() {
  const [setting, session] = await Promise.all([
    prisma.setting.findUnique({ where: { id: "default" } }),
    hubSessionState(),
  ]);

  const base = {
    enabled: setting?.hubEnabled ?? false,
    // Empty means the deployment was never pointed at a hub. The UI must offer
    // to fix that rather than letting every call fail with a fetch error.
    hubUrl: hubUrl(),
    selectedId: setting?.hubConnectionId ?? "",
    signedIn: session.signedIn,
    expiresAt: session.expiresAt,
  };

  // Nothing to list while the integration is off or nobody is signed in, and
  // asking the hub anyway would turn a normal state into an error banner.
  if (!base.enabled || !base.hubUrl || !session.signedIn) {
    return NextResponse.json({ ...base, connections: [] });
  }

  try {
    const connections = await listHubConnections();
    return NextResponse.json({ ...base, connections });
  } catch (e) {
    return NextResponse.json({ ...base, connections: [], ...describe(e) });
  }
}

/** A hub failure as the page renders it: what happened, and what fixes it. */
function describe(e: unknown): { error: string; fix: string; reason: string } {
  if (e instanceof HubNotConfigured) {
    return {
      error: "This app is not pointed at an EmeHub.",
      fix: "Set DAGENT_HUB_URL in .env.local and restart.",
      reason: "not-configured",
    };
  }
  if (e instanceof HubUnreachable) {
    return {
      error: "EmeHub is unreachable.",
      fix: "Check the hub is running and DAGENT_HUB_URL is correct, then retry.",
      reason: "unreachable",
    };
  }
  if (e instanceof HubSignedOut) {
    return {
      error: "The EmeHub session has expired.",
      fix: "Sign in at EmeHub again, then reload this page to reconnect.",
      reason: "signed-out",
    };
  }
  if (e instanceof HubRejected) {
    return {
      error: `EmeHub refused the request (${e.status}). ${e.message}`.trim(),
      fix: "Check that this app is registered at the hub as the 'dagent' audience.",
      reason: "rejected",
    };
  }
  throw e;
}
