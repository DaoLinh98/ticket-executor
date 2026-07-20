import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { DEFAULT_CLAUDE_MODEL, DEFAULT_CLAUDE_EFFORT } from "@/lib/claudeOptions";

export const dynamic = "force-dynamic";

const clean = (s: string) => s.replace(/[\r\n]+/g, "").trim();

const DEFAULTS = {
  provider: clean(process.env.TICKET_PROVIDER ?? "azure-devops"),
  org: process.env.AZURE_DEVOPS_ORG
    ? `https://dev.azure.com/${process.env.AZURE_DEVOPS_ORG}`
    : "",
  pat: "",
  rootRepo: clean(process.env.CLAUDE_ROOT_REPO ?? "C:\\repos"),
  defaultProject: clean(process.env.AZURE_DEVOPS_PROJECT ?? ""),
  sprint: clean(process.env.AZURE_DEVOPS_SPRINT ?? ""),
  animatedBackground: true,
  claudeModel: clean(process.env.CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL),
  claudeEffort: clean(process.env.CLAUDE_EFFORT ?? DEFAULT_CLAUDE_EFFORT),
};

async function getOrCreate() {
  const existing = await prisma.setting.findUnique({ where: { id: "default" } });
  if (existing) return existing;
  return prisma.setting.create({ data: { id: "default", ...DEFAULTS } });
}

export async function GET() {
  const s = await getOrCreate();
  // Never leak the stored PAT to the client; expose only whether one is set.
  return NextResponse.json({
    settings: {
      ...s,
      rootRepo: clean(s.rootRepo),
      defaultProject: clean(s.defaultProject),
      sprint: clean(s.sprint),
      pat: "",
      hasPat: s.pat.length > 0,
    },
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const data: Record<string, string | boolean> = {};
  for (const k of ["provider", "org", "rootRepo", "defaultProject", "sprint", "claudeModel", "claudeEffort"] as const) {
    if (typeof body[k] === "string") data[k] = clean(body[k]);
  }
  if (typeof body.animatedBackground === "boolean") data.animatedBackground = body.animatedBackground;
  // Only overwrite PAT when a non-empty value is supplied; encrypt at rest.
  if (typeof body.pat === "string" && body.pat.length > 0) data.pat = encryptSecret(body.pat);

  const s = await prisma.setting.upsert({
    where: { id: "default" },
    create: { id: "default", ...DEFAULTS, ...data },
    update: data,
  });
  return NextResponse.json({
    settings: { ...s, pat: "", hasPat: s.pat.length > 0 },
  });
}
