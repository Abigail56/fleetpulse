import { describe, expect, it, vi } from "vitest";

import { contentSecurityPolicy } from "./proxy";

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
    vi.unstubAllEnvs();
    expect(connect).toContain("https://api.example.com");
    expect(connect).toContain("wss://api.example.com");
    expect(connect).toContain("https://tiles.openfreemap.org");
    expect(connect.split(" ")).not.toContain("*");
    expect(connect).not.toContain("ws://localhost");
  });
});
