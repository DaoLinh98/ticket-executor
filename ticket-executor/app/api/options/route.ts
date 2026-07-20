import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const KINDS = ["rootRepo", "project", "skill"] as const;
type Kind = (typeof KINDS)[number];
const isKind = (v: unknown): v is Kind => KINDS.includes(v as Kind);

const clean = (s: string) => s.replace(/[\r\n]+/g, "").trim();

// GET /api/options -> { rootRepo: string[], project: string[], skill: string[] }
export async function GET() {
  const rows = await prisma.savedOption.findMany({ orderBy: { createdAt: "asc" } });
  const grouped: Record<Kind, string[]> = { rootRepo: [], project: [], skill: [] };
  for (const r of rows) {
    if (isKind(r.kind)) grouped[r.kind].push(r.value);
  }
  return NextResponse.json(grouped);
}

// POST { kind, value } -> remembers a value so it shows up as an option next time.
export async function POST(req: Request) {
  const body = await req.json();
  const kind = body.kind;
  const value = typeof body.value === "string" ? clean(body.value) : "";
  if (!isKind(kind) || !value) {
    return NextResponse.json({ error: "kind must be rootRepo/project/skill and value must be non-empty" }, { status: 400 });
  }
  await prisma.savedOption.upsert({
    where: { kind_value: { kind, value } },
    create: { kind, value },
    update: {},
  });
  return NextResponse.json({ ok: true });
}
