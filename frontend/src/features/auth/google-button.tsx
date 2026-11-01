"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";

/**
 * Only appears when the API has Google credentials, so it can never be a button that fails.
 * A plain link: the browser must leave for Google, and the API handles the whole exchange.
 */
export function GoogleButton({ next, label }: { next?: string | null; label: string }) {
  const providers = useQuery({
    queryKey: ["auth", "providers"],
    queryFn: () => api<{ google: boolean }>("/auth/providers", { auth: false }),
    staleTime: 300_000,
  });
  if (!providers.data?.google) return null;

  const query = next ? `?next=${encodeURIComponent(next)}` : "";
  const href = `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1/auth/google/start${query}`;
  return (
    <div className="flex flex-col gap-4">
      <a href={href} className="btn btn-outline font-medium shadow-none">
        <svg aria-hidden viewBox="0 0 24 24" className="size-4">
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1A12 12 0 0 0 12 24z"
          />
          <path
            fill="#FBBC05"
            d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.2a12 12 0 0 0 0 10.8l4.1-3.1z"
          />
          <path
            fill="#EA4335"
            d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.2 6.6l4.1 3.1c1-2.9 3.6-4.9 6.7-4.9z"
          />
        </svg>
        {label}
      </a>
      <div className="flex items-center gap-3 text-xs opacity-70">
        <span className="h-px flex-1 bg-base-300" />
        or
        <span className="h-px flex-1 bg-base-300" />
      </div>
    </div>
  );
}
