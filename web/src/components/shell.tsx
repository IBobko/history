import Link from "next/link";
import { ArchiveMark, ArrowUpRight } from "./icons";

export function Header() {
  return <header className="site-header"><Link href="/" className="brand" aria-label="В начало архива"><ArchiveMark/><span>Архив<span className="brand-sub">история в контексте</span></span></Link><nav aria-label="Основная навигация"><Link href="/">Хронология</Link><Link href="/about">Об архиве <ArrowUpRight size={13}/></Link></nav><span className="header-note">Разные события. Общее время.</span></header>;
}

export function Footer() {
  return <footer className="site-footer"><span>TODO100 <span className="footer-dot">·</span> Исторический архив</span><Link href="/about">О материалах и датировке <ArrowUpRight size={12}/></Link></footer>;
}
