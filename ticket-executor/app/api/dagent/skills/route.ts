import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cached, DB_CACHE_PREFIX, invalidatePrefix } from "@/lib/redis";
import { machineSkills, SKILL_OFF_KIND } from "@/lib/dagent/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Which of the machine's skills the judging roles (readiness, QA triage, review triage) are offered. Stored as the
// switched-off names, so a skill installed later is offered until someone turns it off.
const KEY = `${DB_CACHE_PREFIX}dagent-skills-off`;

type DagentSkill = { name: string; description: string; enabled: boolean };

async function list(): Promise<DagentSkill[]> {
  const off = new Set(await cached(KEY, 60, skillsOffOrThrow));
  return machineSkills().map((s) => ({ name: s.name, description: s.description, enabled: !off.has(s.name) }));
}

// `skillsOff()` swallows a failed read for the engine; the cache must never store one.
async function skillsOffOrThrow(): Promise<string[]> {
  const rows = await prisma.savedOption.findMany({ where: { kind: SKILL_OFF_KIND }, select: { value: true } });
  return rows.map((r) => r.value);
}

// GET /api/dagent/skills -> { skills: DagentSkill[] }
export async function GET() {
  try {
    return NextResponse.json({ skills: await list() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the skills." }, { status: 500 });
  }
}

// PUT { name, enabled } -> switches one skill on or off for every later run; returns the whole list.
export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || typeof body.enabled !== "boolean") return NextResponse.json({ error: "name and enabled are required" }, { status: 400 });
  if (!machineSkills().some((s) => s.name === name)) return NextResponse.json({ error: `No skill "${name}" on this machine.` }, { status: 404 });
  if (body.enabled) await prisma.savedOption.deleteMany({ where: { kind: SKILL_OFF_KIND, value: name } });
  else await prisma.savedOption.upsert({ where: { kind_value: { kind: SKILL_OFF_KIND, value: name } }, create: { kind: SKILL_OFF_KIND, value: name }, update: {} });
  await invalidatePrefix(KEY);
  return NextResponse.json({ skills: await list() });
}
