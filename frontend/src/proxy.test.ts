import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { contentSecurityPolicy, isProtectedPath, proxy } from "./proxy";

const directive = (policy: string, name: string) =>
  policy.split("; ").find((item) => item.startsWith(`${name} `)) ?? "";

describe("contentSecurityPolicy", () => {
  it("only runs scripts carrying the response's nonce", () => {
    const script = directive(contentSecurityPolicy("abc", false), "script-src");
    expect(script).toContain("'nonce-abc'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
  });

  it("allows eval only in development, where Next.js needs it", () => {
    expect(directive(contentSecurityPolicy("abc", true), "script-src")).toContain("'unsafe-eval'");
  });

  it("can't be framed, and blocks plugins and base and form hijacking", () => {
    const policy = contentSecurityPolicy("abc", false);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
  });

  it("can only talk to the API, its stream and the map provider", () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.com/");
    const connect = directive(contentSecurityPolicy("abc", false), "connect-src");
    const scripts = directive(contentSecurityPolicy("abc", false), "script-src");
    const styles = directive(contentSecurityPolicy("abc", false), "style-src");
    vi.unstubAllEnvs();
    expect(connect).toContain("https://api.example.com");
    expect(connect).toContain("wss://api.example.com");
    expect(connect).toContain("https://tiles.openfreemap.org");
    expect(connect).toContain("https://maps.geoapify.com");
    expect(connect).not.toContain("maps.googleapis.com");
    expect(scripts).not.toContain("maps.googleapis.com");
    expect(styles).toContain("https://fonts.googleapis.com");
    expect(connect.split(" ")).not.toContain("*");
    expect(connect).not.toContain("ws://localhost");
  });
});

describe("isProtectedPath", () => {
  it.each(["/dashboard", "/dashboard/reports", "/tracking", "/vehicles/123"])(
    "protects %s",
    (pathname) => {
      expect(isProtectedPath(pathname)).toBe(true);
    },
  );

  it.each(["/", "/login", "/register", "/dashboard-old"])("leaves %s public", (pathname) => {
    expect(isProtectedPath(pathname)).toBe(false);
  });

  describe("proxy authentication redirect", () => {
    it("sends a signed-out request to sign in and preserves its return path", () => {
      const request = new NextRequest("https://app.example.com/vehicles/123?tab=documents");
      const response = proxy(request);
      const location = new URL(response.headers.get("location") ?? "");

      expect(response.status).toBe(307);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe("/vehicles/123?tab=documents");
    });

    it("allows requests carrying an access cookie through", () => {
      const request = new NextRequest("https://app.example.com/vehicles/123", {
        headers: { cookie: "fleetpulse_access=token" },
      });

      expect(proxy(request).status).toBe(200);
    });
  });
});
