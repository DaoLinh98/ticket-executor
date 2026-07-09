import { NextResponse } from "next/server";
import { getSprintTickets } from "@/lib/ado";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tickets = await getSprintTickets();
    return NextResponse.json({ tickets });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, tickets: [] }, { status: 500 });
  }
}
