import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { normalizeProvider } from "@/lib/tickets";

export const dynamic = "force-dynamic";

const clean = (s: string) => s.replace(/[\r\n]+/g, "").trim();

async function getOrCreate() {
  const existing = await prisma.setting.findUnique({
    where: { id: "default" },
  });
  if (existing) return existing;
  return prisma.setting.create({ data: { id: "default" } });
}

// GET /api/settings — full settings, credentials for the currently-selected provider.
// GET /api/settings?provider=github — same non-credential fields, but credentials
// (org/hasPat) for the requested provider instead — used when the UI switches the
// provider dropdown without having saved yet.
export async function GET(req: Request) {
  const s = await getOrCreate();
  const { searchParams } = new URL(req.url);
  const provider = normalizeProvider(searchParams.get("provider") ?? s.provider);
  const cred = await prisma.providerCredential.findUnique({ where: { provider } });
  return NextResponse.json({
    settings: {
      ...s,
      org: cred?.org ?? "",
      pat: "",
      hasPat: !!cred && cred.pat.length > 0,
    },
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const data: Record<string, string | boolean | number> = {};
  for (const k of ["provider", "scope", "personalAccount"] as const) {
    if (typeof body[k] === "string") data[k] = clean(body[k]);
  }
  if (typeof body.animatedBackground === "boolean")
    data.animatedBackground = body.animatedBackground;
  if (typeof body.autoImplement === "boolean")
    data.autoImplement = body.autoImplement;
  if (
    typeof body.concurrentRuns === "number" &&
    Number.isFinite(body.concurrentRuns)
  ) {
    data.concurrentRuns = Math.max(
      1,
      Math.min(20, Math.round(body.concurrentRuns)),
    );
  }

  const s = await prisma.setting.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: data,
  });

  // Credentials are stored per-provider, keyed by the provider being saved for.
  const provider = normalizeProvider(typeof body.provider === "string" ? body.provider : s.provider);
  const credData: { org?: string; pat?: string } = {};
  if (typeof body.org === "string") credData.org = clean(body.org);
  // Only overwrite PAT when a non-empty value is supplied; encrypt at rest.
  if (typeof body.pat === "string" && body.pat.length > 0)
    credData.pat = encryptSecret(body.pat);
  const cred = await prisma.providerCredential.upsert({
    where: { provider },
    create: { provider, org: "", pat: "", ...credData },
    update: credData,
  });

  return NextResponse.json({
    settings: { ...s, org: cred.org, pat: "", hasPat: cred.pat.length > 0 },
  });
}
