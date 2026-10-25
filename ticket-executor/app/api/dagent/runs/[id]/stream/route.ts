import { liveStream } from "@/lib/liveStream";
import { runFingerprint } from "@/lib/dagent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return liveStream(req, () => runFingerprint(id));
}
