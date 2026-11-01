import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3210",
  ),
  title: { default: "FleetPulse", template: "%s | FleetPulse" },
  description:
    "Fleet management software for monitoring vehicles, managing drivers and controlling operating costs from one platform.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Each response has its own script nonce, so pages can't be built ahead of time.
  await connection();
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${publicSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
