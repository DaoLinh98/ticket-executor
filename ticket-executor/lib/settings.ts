import { prisma } from "@/lib/prisma";

/** The settings row, created on first read. */
export async function getOrCreateSetting() {
  const existing = await prisma.setting.findUnique({ where: { id: "default" } });
  if (existing) return existing;
  return prisma.setting.create({ data: { id: "default" } });
}
