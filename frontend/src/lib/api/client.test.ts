import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, clearAuthState } from "./client";

function json(status: number, body: unknown = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status });
}

function apiError(status: number, code: string) {
  return json(status, { error: { code, message: code } });
}

function mockFetch(...responses: Response[]) {
  const mock = vi.fn();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function pathOf(call: unknown[]) {
  return String(call[0]).replace("http://api/api/v1", "");
}

function headersOf(call: unknown[]) {
  return (call[1] as RequestInit).headers as Record<string, string>;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
    clearAuthState();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("always sends credentials so the cookies are included", async () => {
    const mock = mockFetch(json(200, { ok: true }));
    await api("/auth/me");
    expect((mock.mock.calls[0][1] as RequestInit).credentials).toBe("include");
  });

  it("recovers the CSRF token before the first write after a reload", async () => {
    const mock = mockFetch(json(200, { csrf_token: "token-1" }), json(204));
    await api("/auth/logout", { method: "POST" });
    expect(mock.mock.calls.map(pathOf)).toEqual(["/auth/me", "/auth/logout"]);
    expect(headersOf(mock.mock.calls[1])["X-CSRF-Token"]).toBe("token-1");
  });

  it("never sends the CSRF token on reads", async () => {
    const mock = mockFetch(json(200, { csrf_token: "token-1" }), json(200, {}));
    await api("/auth/me");
    await api("/auth/sessions");
    expect(headersOf(mock.mock.calls[1])["X-CSRF-Token"]).toBeUndefined();
  });

  it("refreshes an expired session once and retries the request", async () => {
    const mock = mockFetch(
      apiError(401, "not_authenticated"),
      json(200, { csrf_token: "token-2" }),
      json(200, { value: 1 }),
    );
    await expect(api("/auth/sessions")).resolves.toEqual({ value: 1 });
    expect(mock.mock.calls.map(pathOf)).toEqual([
      "/auth/sessions",
      "/auth/refresh",
      "/auth/sessions",
    ]);
  });

  it("reports signed out when the refresh also fails", async () => {
    const mock = mockFetch(
      apiError(401, "not_authenticated"),
      apiError(401, "invalid_session"),
    );
    await expect(api("/auth/me")).rejects.toMatchObject({ code: "not_authenticated" });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("shares one refresh between simultaneous expired requests", async () => {
    const mock = vi.fn(async (url: string) => {
      if (url.endsWith("/auth/refresh")) return json(200, { csrf_token: "t" });
      const refreshed = mock.mock.calls.some((call) => String(call[0]).endsWith("/refresh"));
      return refreshed ? json(200, {}) : apiError(401, "not_authenticated");
    });
    vi.stubGlobal("fetch", mock);
    await Promise.all([api("/a"), api("/b"), api("/c")]);
    const refreshes = mock.mock.calls.filter((call) => String(call[0]).endsWith("/refresh"));
    expect(refreshes).toHaveLength(1);
  });

  it("waits and retries when another tab is refreshing", async () => {
    const mock = mockFetch(
      apiError(401, "not_authenticated"),
      apiError(409, "refresh_in_progress"),
      json(200, { value: 1 }),
    );
    await expect(api("/auth/sessions")).resolves.toEqual({ value: 1 });
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("does not attempt a refresh for wrong login details", async () => {
    const mock = mockFetch(apiError(401, "invalid_credentials"));
    await expect(
      api("/auth/login", { method: "POST", body: {}, auth: false }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("recovers from a stale CSRF token once", async () => {
    const mock = mockFetch(
      json(200, { csrf_token: "old" }),
      apiError(403, "invalid_csrf_token"),
      json(200, { csrf_token: "new" }),
      json(204),
    );
    await api("/auth/me");
    await api("/auth/logout", { method: "POST" });
    expect(headersOf(mock.mock.calls[3])["X-CSRF-Token"]).toBe("new");
  });

  it("turns a network failure into a readable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")));
    const error = await api("/auth/me").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).message).toMatch(/couldn't reach/);
  });

  it("copes with a non-JSON error from a proxy", async () => {
    mockFetch(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(api("/auth/me")).rejects.toMatchObject({
      status: 502,
      code: "unexpected_error",
    });
  });
});
