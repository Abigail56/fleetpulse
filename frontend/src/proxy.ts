import { type NextRequest, NextResponse } from "next/server";

const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/dark";

function originOf(url: string | undefined) {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** Limits what a page can load or send, so a mistake that lets script in has little it can do. */
export function contentSecurityPolicy(nonce: string, isDevelopment: boolean) {
  const api = originOf(process.env.NEXT_PUBLIC_API_BASE_URL);
  const stream = api.replace(/^http/, "ws");
  return [
    "default-src 'self'",
    // Only scripts carrying this response's nonce, and whatever those load.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    // Style attributes are used throughout, and can't run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${api} ${stream} ${originOf(MAP_STYLE_URL)}${isDevelopment ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    // The map draws in a worker.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://")
      ? ["upgrade-insecure-requests"]
      : []),
  ]
    .join("; ")
    .replace(/ +/g, " ");
}

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  // Next.js reads the nonce from this request header, and adds it to its own scripts.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Files that aren't pages can't run script, and don't need a nonce.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|maplibre|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
