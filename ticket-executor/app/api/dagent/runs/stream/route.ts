import { liveStream } from "@/lib/liveStream";
import { listFingerprint } from "@/lib/dagent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return liveStream(req, listFingerprint);
}
