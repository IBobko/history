export const categories = ["Russia", "USA", "Common"] as const;
export type Category = (typeof categories)[number];
export const categoryInfo: Record<Category, { title: string; subtitle: string; short: string }> = {
  Russia: { title: "Россия", subtitle: "Россия, Российская империя, СССР", short: "Россия" },
  USA: { title: "США", subtitle: "История Соединённых Штатов", short: "США" },
  Common: { title: "Мир", subtitle: "Страны и международные события", short: "Мир" },
};

export interface HistoricalDate {
  label: string;
  earliest: string | null;
  latest: string | null;
  precision: "day" | "month" | "year" | "season" | "unknown";
  kind: "point" | "range" | "uncertain";
  calendar: "gregorian" | "julian" | "unknown";
}

export interface ArchiveEvent {
  id: string;
  title: string;
  excerpt: string;
  markdown: string;
  html: string;
  category: Category;
  date: HistoricalDate;
  source: { path: string; line: number; year: number; legacy: boolean };
}

export interface ImportIssue { source: string; line: number; code: string; message: string }
export interface Archive {
  events: ArchiveEvent[];
  years: number[];
  files: number;
  dateBlocks: number;
  issues: ImportIssue[];
}

export interface EventQuery {
  year?: number;
  categories?: Category[];
  search?: string;
}

// Implement this interface for another storage source; UI code does not read files.
export interface EventRepository {
  getArchive(): Promise<Archive>;
  getEvent(id: string): Promise<ArchiveEvent | undefined>;
  findEvents(query: EventQuery): Promise<ArchiveEvent[]>;
}

export function matchesYear(event: ArchiveEvent, year: number): boolean {
  if (!event.date.earliest || !event.date.latest) return event.source.year === year;
  return Number(event.date.earliest.slice(0, 4)) <= year && Number(event.date.latest.slice(0, 4)) >= year;
}

export function normalizeSearch(value: string) {
  return value.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

export function filterEvents(events: ArchiveEvent[], query: EventQuery): ArchiveEvent[] {
  const words = normalizeSearch(query.search ?? "").split(" ").filter(Boolean);
  return events.filter(event => {
    if (query.year !== undefined && !matchesYear(event, query.year)) return false;
    if (query.categories && !query.categories.includes(event.category)) return false;
    const text = normalizeSearch(`${event.title} ${event.date.label} ${event.markdown}`);
    return words.every(word => text.includes(word));
  });
}
