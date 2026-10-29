import { eventRepository } from "@/lib/repository";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const archive = await eventRepository.getArchive();
    if (!archive.events.length) throw new Error("Empty archive");
    return Response.json({ status: "ok", events: archive.events.length, files: archive.files });
  } catch (error) { console.error("Archive health check failed:", error); return Response.json({ status: "unavailable" }, { status: 503 }); }
}
