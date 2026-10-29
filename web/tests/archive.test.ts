import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHistoricalDate } from "../src/lib/dates";
import { importDocument } from "../src/lib/importer";
import { filterEvents } from "../src/lib/model";
import { renderMarkdown } from "../src/lib/markdown";
import { mkdtemp, mkdir, writeFile, symlink, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MarkdownEventRepository } from "../src/lib/repository";

test("old and new style use one Gregorian timeline", () => {
  const old = parseHistoricalDate("1 (14) марта 1917 года", "Russia");
  const modern = parseHistoricalDate("14 марта 1917 года", "USA");
  assert.equal(old.earliest, "1917-03-14"); assert.equal(old.earliest, modern.earliest);
  assert.equal(parseHistoricalDate("28 декабря 1809 (9 января 1810) года", "Russia").earliest, "1810-01-09");
  assert.equal(parseHistoricalDate("31 мая (7 июня) 1223 года", "Russia").earliest, "1223-06-07");
});
test("ranges retain endpoints across calendars and years", () => {
  assert.equal(parseHistoricalDate("3 (16) июня — 24 июня (7 июля) 1917 года", "Russia").latest, "1917-07-07");
  assert.equal(parseHistoricalDate("10 (23) — 17 (30) августа 1914 года", "Russia").earliest, "1914-08-23");
  assert.equal(parseHistoricalDate("13 (26) — 30 августа (12 сентября) 1914 года", "Russia").latest, "1914-09-12");
  const cross = parseHistoricalDate("17 ноября 1991 года — 31 марта 1995 года", "Russia");
  assert.equal(cross.earliest, "1991-11-17"); assert.equal(cross.latest, "1995-03-31");
  assert.equal(parseHistoricalDate("18 (31) декабря 1905 года — 19 декабря 1905 года (1 января 1906 года)", "Russia").latest, "1906-01-01");
});
test("imprecise and night labels retain uncertainty rather than become exact days", () => {
  assert.equal(parseHistoricalDate("сентябрь 9 года", "Common").earliest, "0009-09-01");
  const year = parseHistoricalDate("около 1998 года", "Common");
  assert.equal(year.precision, "year"); assert.equal(year.kind, "uncertain"); assert.equal(year.latest, "1998-12-31");
  const spring = parseHistoricalDate("весна 1998 года", "Common");
  assert.equal(spring.precision, "season"); assert.equal(spring.latest, "1998-05-31");
  const night = parseHistoricalDate("Ночь на 3 июня 2026 года", "Russia");
  assert.equal(night.earliest, "2026-06-02"); assert.equal(night.latest, "2026-06-03");
  assert.equal(parseHistoricalDate("первая половина 1921 года", "Common").latest, "1921-06-30");
  assert.equal(parseHistoricalDate("точная дата неизвестна", "Russia").earliest, null);
  assert.equal(parseHistoricalDate("31 февраля 1998 года", "Russia").earliest, null);
});
test("legacy text and modern events in one date block are preserved; source lines are correct", () => {
  const text = "# 1993\n\n### 1 января 1993 года\n\nСтарая **запись**.\n\n#### Новое событие\n\nПолный текст.\n\n---\n\n### Неизвестная дата\n\n**Ещё событие**.\n";
  const result = importDocument(text, "Russia/1993.md", "Russia", 1993);
  assert.equal(result.events.length, 3); assert.equal(result.dateBlocks, 2);
  assert.equal(result.events[0].markdown, "Старая **запись**.");
  assert.equal(result.events[1].markdown, "Полный текст.");
  assert.equal(result.events[1].source.line, 7);
  assert.ok(result.issues.some(issue => issue.code === "unknown_date"));
  const changed = importDocument(text.replace("Полный текст.", "Текст после правки."), "Russia/1993.md", "Russia", 1993);
  assert.equal(result.events[1].id, changed.events[1].id);
});
test("events spanning years appear in intermediate years; search and categories combine", () => {
  const { events } = importDocument("### 17 ноября 1991 года — 31 марта 1995 года\n\n#### Процесс\n\nСобытие с буквой ё.\n", "Russia/1991.md", "Russia", 1991);
  assert.equal(filterEvents(events, { year: 1993, search: "Е", categories: ["Russia"] }).length, 1);
  assert.equal(filterEvents(events, { year: 1996 }).length, 0);
  assert.equal(filterEvents(events, { categories: [] }).length, 0);
});
test("Markdown renders links and tables without executing embedded markup", () => {
  const html = renderMarkdown('[Источник](https://example.org)\n\n<script>alert(1)</script><img src=x onerror="alert(1)">\n\n[опасно](javascript:alert(1))');
  assert.match(html, /href="https:\/\/example.org"/); assert.doesNotMatch(html, /<script|onerror|javascript:/);
});

test("repository follows an atomic release switch without restarting or reusing the old index", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "history-release-"));
  const previousRoot = process.env.ARCHIVE_ROOT;
  try {
    for (const release of ["first", "second"]) {
      for (const category of ["Russia", "USA", "Common"]) {
        const folder = path.join(directory, release, category);
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, "1991.md"), `### 1 января 1991 года\n\n#### ${release}\n\nПолный текст.\n`);
      }
    }
    const current = path.join(directory, "current");
    await symlink("first", current);
    process.env.ARCHIVE_ROOT = current;
    const repository = new MarkdownEventRepository();
    const first = await repository.getArchive();
    assert.equal(first.events.length, 3);
    assert.ok(first.events.every(event => event.title === "first"));
    await symlink("second", path.join(directory, "next"));
    await rename(path.join(directory, "next"), current);
    const second = await repository.getArchive();
    assert.equal(second.events.length, 3);
    assert.ok(second.events.every(event => event.title === "second"));
    assert.ok(first.events.every(event => event.title === "first"));
  } finally {
    if (previousRoot === undefined) delete process.env.ARCHIVE_ROOT;
    else process.env.ARCHIVE_ROOT = previousRoot;
    await rm(directory, { recursive: true, force: true });
  }
});
