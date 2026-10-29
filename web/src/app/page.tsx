import Link from "next/link";
import { eventRepository } from "@/lib/repository";
import { categories, categoryInfo, filterEvents, type ArchiveEvent, type Category } from "@/lib/model";
import { monthNames } from "@/lib/dates";
import { ArrowRight, ArrowUpRight, BookOpen, Check, ChevronLeft, ChevronRight, Columns3, Globe2, LayoutList, Search, X } from "@/components/icons";

export const dynamic = "force-dynamic";
type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;
const number = (value: string | undefined) => value && /^\d{1,4}$/.test(value) ? Number(value) : undefined;
const count = (n: number) => new Intl.NumberFormat("ru").format(n);
function noun(n: number) { return new Intl.PluralRules("ru").select(n) === "one" ? "событие" : new Intl.PluralRules("ru").select(n) === "few" ? "события" : "событий"; }

export default async function Home({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const archive = await eventRepository.getArchive();
  const query = (first(params.q) ?? "").trim().slice(0, 300);
  const defaultYear = archive.years.includes(1993) ? 1993 : archive.years[0];
  const rawYear = first(params.year);
  const year = rawYear === "all" || (!rawYear && query) ? undefined : number(rawYear) ?? defaultYear;
  const rawCategory = first(params.category);
  const selected = rawCategory === undefined ? [...categories] : categories.filter(category => rawCategory.split(",").includes(category));
  const view = first(params.view) === "parallel" ? "parallel" : "list";
  const events = filterEvents(archive.events, { year, categories: selected, search: query });
  const pages = Math.max(1, Math.ceil(events.length / 60));
  const page = Math.min(pages, Math.max(1, Number.parseInt(first(params.page) ?? "1") || 1));
  const visible = events.slice((page - 1) * 60, page * 60);
  function url(changes: Record<string, string | number | undefined> = {}) {
    const values: Record<string, string | undefined> = { year: year === undefined ? "all" : String(year), q: query || undefined, category: rawCategory, view: view === "parallel" ? view : undefined };
    for (const [key, value] of Object.entries(changes)) values[key] = value === undefined ? undefined : String(value);
    const result = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value !== undefined) result.set(key, value);
    return `/?${result.toString()}`;
  }
  const chronologicalYears = [...archive.years].sort((a, b) => a - b);
  const yearIndex = year === undefined ? -1 : chronologicalYears.indexOf(year);
  const around = yearIndex < 0 ? chronologicalYears.filter(y => y >= 1989 && y <= 2000).slice(0, 9) : chronologicalYears.slice(Math.max(0, Math.min(yearIndex - 4, chronologicalYears.length - 9)), Math.max(9, yearIndex + 5));
  const byCategory = filterEvents(archive.events, { year, search: query });
  const groups = new Map<string, ArchiveEvent[]>();
  for (const event of visible) {
    let key = event.date.earliest?.slice(0, 7) ?? `${event.source.year}-unknown`;
    if (year !== undefined && event.date.earliest && Number(event.date.earliest.slice(0, 4)) < year) key = `${year}-00`;
    // A year-only or approximate-year label must not look like a January date.
    if (event.date.precision === "year" && key !== `${year}-00`) key = `${event.date.earliest?.slice(0, 4) ?? event.source.year}-year`;
    const group = groups.get(key) ?? []; group.push(event); groups.set(key, group);
  }
  const groupLabel = (key: string) => {
    const [y, m] = key.split("-");
    if (m === "00") return "Начались ранее";
    if (m === "unknown") return `${y} · Дата требует уточнения`;
    if (m === "year") return `${y} · В течение года`;
    return `${monthNames[Number(m) - 1]}${year === undefined ? ` ${y}` : ""}`;
  };

  return <div className="workspace"><aside className="sidebar" aria-label="Навигация по архиву">
    <div className="sidebar-heading"><BookOpen size={16}/><span>Картотека</span><span className="small-label">01</span></div>
    <div className="sidebar-section"><p className="eyebrow">Исторические линии</p>
      {categories.map(category => {
        const active = selected.includes(category);
        const next = active ? selected.filter(c => c !== category) : [...selected, category];
        return <Link key={category} href={url({ category: next.join(",") || "none" })} className={`category-option ${active ? "selected" : ""}`} aria-label={`${active ? "Скрыть" : "Показать"} линию «${categoryInfo[category].title}»`} aria-pressed={active} role="button"><span className={`category-dot ${category}`}/><span>{categoryInfo[category].title}</span><span className="category-count">{count(byCategory.filter(e => e.category === category).length)}</span><span className="check-box">{active && <Check size={11}/>}</span></Link>;
      })}
      <Link href={url({ category: undefined })} className="text-action">Показать все линии <ArrowRight size={13}/></Link>
    </div>
    <div className="sidebar-section"><p className="eyebrow">Период</p><form action="/" className="year-form">
      {query && <input type="hidden" name="q" value={query}/>}{rawCategory && <input type="hidden" name="category" value={rawCategory}/>}{view === "parallel" && <input type="hidden" name="view" value="parallel"/>}
      <label className="sr-only" htmlFor="year">Год</label><select name="year" id="year" key={year ?? "all"} defaultValue={year ?? "all"}><option value="all">Все годы</option>{archive.years.map(y => <option value={y} key={y}>{y} год</option>)}</select><button type="submit" className="button year-submit" aria-label="Перейти к выбранному году"><ArrowRight size={15}/></button>
    </form><p className="field-note">От {Math.min(...archive.years)} до {Math.max(...archive.years)} года</p></div>
    <div className="sidebar-bottom"><Globe2 size={20}/><p>Одна история —<br/>множество пересечений.</p><span>Сопоставляйте события<br/>в общем времени.</span></div>
  </aside>

  <main id="main" className="main-content"><div className="breadcrumb"><span>Картотека</span><span>/</span><span>Хронология</span></div>
    <div className="page-intro"><div><p className="eyebrow">История в контексте</p><h1>{year ?? "Все годы"}<span>{year ? "год" : "архива"}</span></h1><p className="intro-description">{query ? <>Результаты поиска по историческим событиям.</> : <>События, которые складываются в историю.<br className="desktop-break"/>Читайте последовательно или сравнивайте линии.</>}</p></div><div className="archive-stat"><span>{count(archive.events.length)}</span><p>записей в архиве</p><div><span className="live-dot"/> {archive.files} годовых файлов</div></div></div>

    <form className="search-form" action="/" role="search"><Search size={19}/><label htmlFor="search" className="sr-only">Поиск по всему архиву</label><input id="search" name="q" type="search" key={query} defaultValue={query} placeholder="Событие, имя, документ…" maxLength={300}/><input type="hidden" name="year" value="all"/>{rawCategory && <input type="hidden" name="category" value={rawCategory}/>}{view === "parallel" && <input type="hidden" name="view" value="parallel"/>}<span className="search-scope">По всему архиву</span><button type="submit" aria-label="Найти"><ArrowRight size={18}/></button></form>

    <div className="year-navigation" aria-label="Ближайшие годы"><Link href={url({ year: yearIndex > 0 ? chronologicalYears[yearIndex - 1] : "all" })} aria-label="Предыдущий период" className="year-arrow"><ChevronLeft size={17}/></Link><div className="year-track">{around.map(y => <Link key={y} href={url({ year: y })} className={year === y ? "active" : ""} aria-current={year === y ? "page" : undefined}>{y}<span/></Link>)}</div><Link href={url({ year: yearIndex >= 0 && yearIndex < chronologicalYears.length - 1 ? chronologicalYears[yearIndex + 1] : "all" })} aria-label="Следующий период" className="year-arrow"><ChevronRight size={17}/></Link></div>

    <div className="view-toolbar"><div><span className="result-count">{count(events.length)} {noun(events.length)}</span>{query && <Link href={url({ q: undefined })} className="query-chip">«{query}» <X size={12}/></Link>}</div><div className="view-switch" aria-label="Вид хронологии"><Link href={url({ view: undefined })} className={view === "list" ? "active" : ""} aria-current={view === "list" ? "true" : undefined}><LayoutList size={15}/><span>Лента</span></Link><Link href={url({ view: "parallel" })} className={view === "parallel" ? "active" : ""} aria-current={view === "parallel" ? "true" : undefined}><Columns3 size={15}/><span>Параллельно</span></Link></div></div>

    {view === "parallel" && selected.length > 0 && <p className="comparison-note">Общая шкала — месяцы григорианского календаря. В карточках сохранена исходная датировка.</p>}
    {!events.length ? <div className="empty-state"><Search size={28}/><h2>События не найдены</h2><p>{selected.length ? "Попробуйте другое слово, год или историческую линию." : "Выберите хотя бы одну историческую линию."}</p><Link href="/" className="button">Сбросить фильтры <ArrowRight size={15}/></Link></div> : <div className={view === "parallel" ? "parallel-scroll" : "event-feed"}>
      {view === "parallel" && <div className="parallel-header" style={{ "--columns": selected.length } as React.CSSProperties}><span>Время</span>{selected.map(c => <span key={c}><i className={`category-dot ${c}`}/>{categoryInfo[c].title}</span>)}</div>}
      {[...groups].map(([key, group]) => view === "parallel" ? <section key={key} className="parallel-row" style={{ "--columns": selected.length } as React.CSSProperties}><h2>{groupLabel(key)}</h2>{selected.map(category => <div className="parallel-cell" key={category}>{group.filter(e => e.category === category).map(e => <EventCard event={e} compact key={e.id}/>)}{!group.some(e => e.category === category) && <span className="no-events" aria-label="Нет записей">—</span>}</div>)}</section> : <section className="month-section" key={key}><div className="month-heading"><span className="month-node"/><h2>{groupLabel(key)}</h2><span>{group.length}</span></div>{group.map(event => <EventCard key={event.id} event={event}/>)}</section>)}
    </div>}
    {pages > 1 && <nav className="pagination" aria-label="Страницы событий">{page > 1 ? <Link className="button button-quiet" href={url({ page: page - 1 })}><ChevronLeft size={15}/> Назад</Link> : <span/>}<span>{page} / {pages}</span>{page < pages ? <Link className="button button-quiet" href={url({ page: page + 1 })}>Дальше <ChevronRight size={15}/></Link> : <span/>}</nav>}
    <div className="reading-note"><BookOpen size={15}/><p>Соседство во времени помогает увидеть контекст. Причинные связи требуют отдельного обоснования.</p><Link href="/about" aria-label="Подробнее об архиве"><ArrowUpRight size={16}/></Link></div>
  </main></div>;
}

function EventCard({ event, compact = false }: { event: ArchiveEvent; compact?: boolean }) {
  const label = event.date.kind === "range" ? "Период" : event.date.precision === "day" ? undefined : "Неточная дата";
  return <article className={`event-card ${compact ? "compact" : ""}`}><div className="event-card-top"><span className={`category-tag ${event.category}`}><i/>{categoryInfo[event.category].short}</span>{label && <span className="date-kind">{label}</span>}</div><p className="event-date">{event.date.label}</p><h3><Link href={`/events/${event.id}`}>{event.title}</Link></h3><p className="event-excerpt">{event.excerpt}</p><Link className="event-open" href={`/events/${event.id}`} aria-label={`Читать: ${event.title}`}>{compact ? "Читать" : "Читать событие"} <ArrowUpRight size={14}/></Link></article>;
}
