import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Source_Sans_3,
  Libre_Baskerville,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { requestVersion } from "@/lib/request-version";
import { Navigation } from "@/components/navigation";

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const libreBaskerville = Libre_Baskerville({
  variable: "--font-libre-baskerville",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "RIPE Knowledge Graph",
    template: "%s | RIPE Knowledge Graph",
  },
  description: "A knowledge graph connecting assessments to publications, authors, and evidence",
  openGraph: {
    title: "RIPE Knowledge Graph",
    description: "A knowledge graph connecting assessments to publications, authors, and evidence",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const version = await requestVersion();
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body className={`${sourceSans.variable} ${libreBaskerville.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers key={version} version={version}>
          <div className="min-h-screen flex flex-col">
            <Navigation />
            <main className="flex-1">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
