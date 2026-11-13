import { Analytics } from '@vercel/analytics/react';
import type { Metadata, Viewport } from "next";

import { Inter } from "next/font/google";

import RegisterServiceWorker from "./register-sw";

import { SiteNav, SiteFooter } from "./site-nav";

import "./globals.css";


const InterSans = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});
export const metadata: Metadata = {
  title: "TradeQuote PRO",
  description: "Industrial Shutdown & Electrical Contracting Operations Hub",
  applicationName: "TradeQuote PRO",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "TradeQuote",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#020617",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${InterSans.variable} font-sans h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <RegisterServiceWorker />
        <SiteNav />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <Analytics />
        </body>
    </html>
  );
}
