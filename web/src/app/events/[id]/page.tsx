import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eventRepository } from "@/lib/repository";
import { categoryInfo } from "@/lib/model";
import { comparisonLabel } from "@/lib/dates";
import { ArrowLeft, ArrowUpRight, FileText } from "@/components/icons";
import { CopyLink } from "@/components/copy-link";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const event = await eventRepository.getEvent((await params).id);
  return event ? { title: event.title, description: event.excerpt.slice(0, 200), alternates: { canonical: `/events/${event.id}` } } : { title: "Событие не найдено" };
}
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const event = await eventRepository.getEvent((await params).id);
  if (!event) notFound();
  const compare = comparisonLabel(event.date);
  const year = event.date.earliest ? Number(event.date.earliest.slice(0, 4)) : event.source.year;
  return <main id="main" className="detail-page"><Link href={`/?year=${year}`} className="back-link"><ArrowLeft size={15}/> К хронологии {year} года</Link><div className="detail-grid"><article className="detail-article"><div className="event-card-top"><span className={`category-tag ${event.category}`}><i/>{categoryInfo[event.category].title}</span><span className="small-label">Событие архива</span></div><p className="detail-date">{event.date.label}</p><h1>{event.title}</h1><div className="prose" dangerouslySetInnerHTML={{ __html: event.html }}/><div className="detail-actions"><CopyLink/></div></article><aside className="detail-aside"><p className="eyebrow">Контекст записи</p><dl><dt>Историческая линия</dt><dd>{categoryInfo[event.category].subtitle}</dd><dt>Датировка</dt><dd>{event.date.kind === "range" ? "Период" : event.date.kind === "uncertain" ? "Неполная или приблизительная" : "Конкретный день"}</dd>{event.date.calendar === "julian" && <><dt>Общая шкала · новый стиль</dt><dd>{compare ?? "Интервал сопоставления рассчитан по григорианскому календарю."}</dd></>}<dt>Исходный документ</dt><dd><Link href={`/source/${event.category}/${event.source.year}`} className="source-link"><FileText size={14}/>{event.source.path}<ArrowUpRight size={12}/></Link><span className="field-note">Строка {event.source.line}</span></dd></dl><p className="detail-note">Текст и исходная формулировка даты сохранены из архива.</p></aside></div></main>;
}
