import { notificationHistoryScope } from "@/lib/notificationSources";
import { HISTORY_PAGE_MAX, loadHistory } from "@/lib/notificationHistory";
import { jsonNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const scope = await notificationHistoryScope(params.get("provider") ?? undefined);
  if (!scope) return jsonNoStore({ items: [], next: null });
  const limit = Number(params.get("limit")) || HISTORY_PAGE_MAX;
  return jsonNoStore(await loadHistory(scope, params.get("before"), limit));
}
