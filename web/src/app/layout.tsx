import type { Metadata, Viewport } from "next";
import { Header, Footer } from "@/components/shell";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "https://todo100.ru"),
  title: { default: "Архив — история в контексте", template: "%s · Архив" },
  description: "Исторические события России, США и мира. Читайте хронологию, находите события и сопоставляйте параллельные процессы.",
  robots: { index: true, follow: true },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f7f7f2" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body><a href="#main" className="skip-link">Перейти к содержимому</a><Header/>{children}<Footer/></body></html>;
}
