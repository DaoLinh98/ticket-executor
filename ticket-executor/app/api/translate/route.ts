import { NextResponse } from "next/server";
import { translateToVietnamese } from "@/lib/executionStore";

export const dynamic = "force-dynamic";

// POST /api/translate — one comment's text, translated into Vietnamese.
// Body: { text: string }. Nothing is stored: the source lives in the provider
// and the translation is cheap to ask for again.
export async function POST(req: Request) {
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const text = typeof body.text === "string" ? body.text : "";
  const result = await translateToVietnamese(text);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ vietnamese: result.vietnamese });
}
