import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/** Polices locales : évite l’échec CI/deploy quand Google Fonts est injoignable. */
const montserrat = localFont({
  src: [
    { path: "../../public/fonts/Montserrat-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/Montserrat-Regular.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/Montserrat-Bold.ttf", weight: "600", style: "normal" },
    { path: "../../public/fonts/Montserrat-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "THEBEST SARL - Gestion Opérationnelle",
  description: "Plateforme de gestion des rapports, présences et ventes billets.",
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/favicon-thebest.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/favicon-thebest.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('thebest-theme') : null;
    const isDark = saved === 'dark' || (saved !== 'light' && typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  } catch (e) {}

  try {
    function sendClientError(payload) {
      try {
        if (navigator && navigator.sendBeacon) {
          navigator.sendBeacon('/api/client-errors', JSON.stringify(payload));
          return;
        }
      } catch (_) {}

      try {
        fetch('/api/client-errors', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } catch (_) {}
    }

    window.addEventListener('error', function (ev) {
      try {
        const err = ev.error || {};
        sendClientError({ message: err.message || String(ev.message || 'unknown'), stack: err.stack || null, filename: ev.filename || null, lineno: ev.lineno || null, colno: ev.colno || null, userAgent: navigator.userAgent, href: location.href });
      } catch (_) {}
    });

    window.addEventListener('unhandledrejection', function (ev) {
      try {
        const reason = ev.reason || {};
        sendClientError({ message: reason.message || String(reason || 'unhandledrejection'), stack: reason.stack || null, type: 'unhandledrejection', userAgent: navigator.userAgent, href: location.href });
      } catch (_) {}
    });
  } catch (e) {}
})();`,
          }}
        />
      </head>
      <body
        className={`${montserrat.variable} antialiased`}
        style={{ ["--font-geist-mono" as string]: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
      >
        {children}
      </body>
    </html>
  );
}
