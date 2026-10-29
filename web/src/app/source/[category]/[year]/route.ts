import { readSource } from "@/lib/repository";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ category: string; year: string }> }) {
  const { category, year } = await params;
  const text = await readSource(category, year);
  return text === null ? new Response("Файл не найден", { status: 404 }) : new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `inline; filename="${category}-${year}.md"`, "X-Robots-Tag": "noindex" } });
}
