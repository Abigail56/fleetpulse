"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";

export function ThemeProvider({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  return (
    <NextThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      themes={["light", "dark"]}
      storageKey="fleetpulse-theme"
      nonce={nonce}
    >
      {children}
    </NextThemeProvider>
  );
}
