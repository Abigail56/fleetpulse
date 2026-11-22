import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Manrope, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";
import { connection } from "next/server";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});
const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
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
  icons: {
    icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/fleetpulse-mark.svg`,
    shortcut: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/fleetpulse-mark.svg`,
    apple: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/fleetpulse-mark.png`,
  },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Each response has its own script nonce, so pages can't be built ahead of time.
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${manrope.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
