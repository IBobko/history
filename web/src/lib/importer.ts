import { createHash } from "node:crypto";
import { parseHistoricalDate } from "./dates";
import { plainText, renderMarkdown } from "./markdown";
import type { ArchiveEvent, Category, ImportIssue } from "./model";

export function importDocument(text: string, path: string, category: Category, sourceYear: number) {
  const issues: ImportIssue[] = [];
  const events: ArchiveEvent[] = [];
  const headers = [...text.matchAll(/^###\s+(.+?)\s*$/gm)];
  const issue = (line: number, code: string, message: string) => issues.push({ source: path, line, code, message });
  const lineAt = (offset: number) => text.slice(0, offset).split("\n").length;
  if (!headers.length) issue(1, "no_dates", "Нет заголовков дат. Документ доступен как исходный файл.");
  const preamble = text.slice(0, headers[0]?.index ?? text.length).trim();
  if (preamble.replace(/^#{1,2} .*$/gm, "").replace(/---/g, "").trim()) issue(1, "preamble", "Текст перед первой датой сохранён в исходном документе.");
  for (const [index, header] of headers.entries()) {
    const label = header[1];
    const offset = header.index! + header[0].length;
    const body = text.slice(offset, headers[index + 1]?.index ?? text.length).replace(/(?:\n\s*---\s*)+$/, "").trim();
    const eventHeaders = [...body.matchAll(/^####\s+(.+?)\s*$/gm)];
    const pieces: { title?: string; markdown: string; line: number }[] = [];
    const bodyStart = text.indexOf(body, offset);
    const intro = body.slice(0, eventHeaders[0]?.index ?? body.length).trim();
    if (intro) pieces.push({ markdown: intro, line: lineAt(bodyStart) });
    for (const [i, h] of eventHeaders.entries()) {
      pieces.push({ title: plainText(h[1]), markdown: body.slice(h.index! + h[0].length, eventHeaders[i + 1]?.index ?? body.length).trim(), line: lineAt(bodyStart + h.index!) });
    }
    if (!pieces.length) issue(lineAt(header.index!), "empty_date", `Пустой блок: ${label}`);
    const date = parseHistoricalDate(label, category);
    if (!date.earliest) issue(lineAt(header.index!), "unknown_date", `Дата сохранена текстом: ${label}`);
    const literalYear = label.replace(/\([^)]*\)/g, "").match(/\b(\d{3,4})\b/)?.[1];
    if (literalYear && Number(literalYear) !== sourceYear) issue(lineAt(header.index!), "year_mismatch", `Год даты (${literalYear}) отличается от имени файла (${sourceYear}).`);
    for (const piece of pieces) {
      const markdown = piece.markdown;
      const excerpt = plainText(markdown);
      const bold = markdown.match(/\*\*([^*\n]+)\*\*/)?.[1];
      const title = piece.title || (bold ? plainText(bold) : excerpt.split(/(?<=[.!?])\s/)[0]?.slice(0, 140)) || "Запись архива";
      const base = createHash("sha256").update(`${category}\0${label}\0${title}`).digest("hex").slice(0, 20);
      const duplicate = events.filter(event => event.id === base || event.id.startsWith(`${base}-`)).length;
      const id = duplicate ? `${base}-${duplicate + 1}` : base;
      if (duplicate) issue(piece.line, "duplicate_identity", `Повторяющиеся дата и заголовок: ${title}`);
      events.push({ id, title, excerpt, markdown, html: renderMarkdown(markdown), category, date, source: { path, line: piece.line, year: sourceYear, legacy: !piece.title } });
    }
  }
  return { events, issues, dateBlocks: headers.length };
}
