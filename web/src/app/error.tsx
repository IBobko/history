"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main id="main" className="empty-state not-found"><h1>Не удалось открыть архив</h1><p>Попробуйте загрузить страницу ещё раз.</p><button className="button" onClick={() => reset()}>Повторить</button></main>; }
