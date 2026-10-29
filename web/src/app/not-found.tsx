import Link from "next/link";
export default function NotFound() { return <main id="main" className="empty-state not-found"><span className="eyebrow">404</span><h1>Запись не найдена</h1><p>Возможно, её адрес изменился при обновлении архива.</p><Link href="/" className="button">Открыть хронологию</Link></main>; }
