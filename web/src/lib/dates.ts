import type { Category, HistoricalDate } from "./model";

const months: Record<string, number> = {
  январь: 1, января: 1, февраль: 2, февраля: 2, март: 3, марта: 3,
  апрель: 4, апреля: 4, май: 5, мая: 5, июнь: 6, июня: 6,
  июль: 7, июля: 7, август: 8, августа: 8, сентябрь: 9, сентября: 9,
  октябрь: 10, октября: 10, ноябрь: 11, ноября: 11, декабрь: 12, декабря: 12,
};
export const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
type Parts = { year: number; month?: number; day?: number; season?: boolean };

function lastDay(year: number, month: number, julian: boolean) {
  if (month === 2) return (julian ? year % 4 === 0 : year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function iso(year: number, month: number, day: number, julian: boolean) {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > lastDay(year, month, julian)) throw new Error("Invalid date");
  // Gregorian JS dates are used only as a transport for calendar arithmetic.
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  if (julian) {
    let offset = Math.floor(year / 100) - Math.floor(year / 400) - 2;
    if (month < 3 && year % 100 === 0 && year % 400 !== 0) offset--;
    value.setUTCDate(value.getUTCDate() + offset);
  }
  return value.toISOString().slice(0, 10);
}

function endpoint(text: string, fallback: Parts): Parts | null {
  const year = Number(text.match(/\b(\d{1,4})\s+год(?:а|у|ы)?(?=\s|$)/)?.[1] ?? text.match(/\b(\d{3,4})\b/)?.[1] ?? (/^\d{1,4}$/.test(text.trim()) && !fallback.month ? text.trim() : fallback.year));
  const monthWord = text.match(/[а-яё]+/gu)?.find(word => months[word]);
  const month = monthWord ? months[monthWord] : undefined;
  const day = monthWord ? text.slice(0, text.indexOf(monthWord)).match(/\b(\d{1,2})\s*$/)?.[1] : undefined;
  if (month) return { year, month, ...(day ? { day: Number(day) } : {}) };
  if (/^\d{1,2}$/.test(text.trim()) && fallback.month) return { year, month: fallback.month, day: Number(text.trim()) };
  if (/весна|лето|осень|зима/.test(text)) return { year, month: /весна/.test(text) ? 3 : /лето/.test(text) ? 6 : /осень/.test(text) ? 9 : 12, season: true };
  if (/\b\d{3,4}\b|\b\d{1,4}\s+год/.test(text) || /^\d{1,4}$/.test(text.trim())) return { year };
  return null;
}

export function parseHistoricalDate(label: string, category: Category): HistoricalDate {
  const unknown: HistoricalDate = { label, earliest: null, latest: null, precision: "unknown", kind: "uncertain", calendar: "unknown" };
  let text = label.toLowerCase().replaceAll("ё", "е").replace(/\([^)]*\)/g, "").replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const firstYear = Number(text.match(/\b(\d{1,4})\s+год(?:а|у|ы)?(?=\s|$)/)?.[1] ?? text.match(/\b(\d{3,4})\b/)?.[1]);
  if (!firstYear) return unknown;
  const hasDualStyle = /\([^)]*\d[^)]*\)/.test(label);
  const julian = hasDualStyle || (category === "Russia" && firstYear < 1918);
  const calendar = julian ? "julian" : "gregorian";
  const night = text.startsWith("ночь");
  const nightBefore = text.startsWith("ночь на ");
  text = text.replace(/^ночь с /, "").replace(/^ночь на /, "").replace(/^с /, "").replace(/\s+(?:по|на)\s+/g, "-");
  const approximate = /начало|середина|конец|около|примерно|приблизительно|половина/.test(text);
  const segments = text.split(/\s*-\s*/);
  if (segments.length > 2) return unknown;
  const fallback: Parts = { year: firstYear };
  let end = endpoint(segments.at(-1)!, fallback);
  if (!end) return unknown;
  let start = endpoint(segments[0], { ...end, year: firstYear });
  if (!start) return unknown;
  if (segments.length === 1) end = { ...start };
  if (/первая половина/.test(text)) { start = { year: firstYear, month: 1 }; end = { year: firstYear, month: 6 }; }
  if (/вторая половина/.test(text)) { start = { year: firstYear, month: 7 }; end = { year: firstYear, month: 12 }; }
  let endYear = end.year;
  let endMonth = end.month ?? 12;
  if (end.season) { endMonth += 2; if (endMonth > 12) { endMonth -= 12; endYear++; } }
  try {
    let earliest = iso(start.year, start.month ?? 1, start.day ?? 1, julian);
    const latest = iso(endYear, endMonth, end.day ?? lastDay(endYear, endMonth, julian), julian);
    if (nightBefore) {
      const date = new Date(`${earliest}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - 1);
      earliest = date.toISOString().slice(0, 10);
    }
    if (earliest > latest) return unknown;
    return {
      label, earliest, latest, calendar,
      precision: start.season ? "season" : start.day && end.day ? "day" : start.month ? "month" : "year",
      kind: approximate || start.season || (!start.day && segments.length === 1) ? "uncertain" : segments.length > 1 || night ? "range" : "point",
    };
  } catch { return unknown; }
}

export function comparisonLabel(date: HistoricalDate) {
  if (!date.earliest || date.precision !== "day") return null;
  const format = (value: string) => new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  return date.earliest === date.latest ? format(date.earliest) : `${format(date.earliest)} — ${format(date.latest!)}`;
}
