"use client";
import { useState } from "react";
import { Check, Link2 } from "./icons";

export function CopyLink() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setError(false); setTimeout(() => setCopied(false), 2500); }
    catch { setError(true); }
  }
  return <><button className="button button-quiet" onClick={copy}>{copied ? <Check size={15}/> : <Link2 size={15}/>} {copied ? "Ссылка скопирована" : "Скопировать ссылку"}</button>{error && <span role="status" className="muted">Скопируйте адрес из строки браузера.</span>}</>;
}
