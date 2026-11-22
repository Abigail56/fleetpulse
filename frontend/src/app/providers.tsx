"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useTheme } from "next-themes";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
}

let browserClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  browserClient ??= makeQueryClient();
  return browserClient;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
      <Toaster position="bottom-right" theme={resolvedTheme === "dark" ? "dark" : "light"} />
    </QueryClientProvider>
  );
}
