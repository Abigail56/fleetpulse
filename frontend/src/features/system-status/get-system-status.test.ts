import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSystemStatus } from "./get-system-status";

function mockFetchJson(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
  );
}

describe("getSystemStatus", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the checks when the API is ready", async () => {
    const checks = { database: "ok", redis: "ok" };
    mockFetchJson({ status: "ready", checks });
    await expect(getSystemStatus("http://api")).resolves.toEqual({
      state: "ready",
      checks,
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://api/api/v1/health/ready",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reads the failing checks from a 503 response", async () => {
    const checks = { database: "unavailable", redis: "ok" };
    mockFetchJson({ status: "not_ready", checks }, 503);
    await expect(getSystemStatus("http://api")).resolves.toEqual({
      state: "not_ready",
      checks,
    });
  });

  it("reports unreachable and logs when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("refused")));
    await expect(getSystemStatus("http://api")).resolves.toEqual({
      state: "unreachable",
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("reports unreachable for an unexpected response body", async () => {
    mockFetchJson({ hello: "world" });
    await expect(getSystemStatus("http://api")).resolves.toEqual({
      state: "unreachable",
    });
  });

  it("reports unreachable when the API URL is not configured", async () => {
    vi.stubEnv("API_BASE_URL", "");
    await expect(getSystemStatus()).resolves.toEqual({ state: "unreachable" });
    vi.unstubAllEnvs();
  });
});
