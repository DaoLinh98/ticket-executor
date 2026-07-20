import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const clean = (s: string) => s.replace(/[\r\n]+/g, "").trim();

// GET /api/options/mapping?project=foo -> { rootRepo: string | null }
export async function GET(req: Request) {
  const project = clean(new URL(req.url).searchParams.get("project") ?? "");
  if (!project) return NextResponse.json({ rootRepo: null });
  const row = await prisma.rootRepoProjectMap.findUnique({ where: { project } });
  return NextResponse.json({ rootRepo: row?.rootRepo ?? null });
}

// POST { project, rootRepo } -> remembers which root repo this project last ran with.
export async function POST(req: Request) {
  const body = await req.json();
  const project = typeof body.project === "string" ? clean(body.project) : "";
  const rootRepo = typeof body.rootRepo === "string" ? clean(body.rootRepo) : "";
  if (!project || !rootRepo) {
    return NextResponse.json({ error: "project and rootRepo are required" }, { status: 400 });
  }
  await prisma.rootRepoProjectMap.upsert({
    where: { project },
    create: { project, rootRepo },
    update: { rootRepo },
  });
  return NextResponse.json({ ok: true });
}
