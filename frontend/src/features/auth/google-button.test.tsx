import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GoogleButton } from "./google-button";
import { errorResponse, jsonResponse, renderWithQuery } from "./test-utils";

function mockProviders(response: Response) {
  const mock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("GoogleButton", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("links to the API when Google is configured, keeping the return path", async () => {
    mockProviders(jsonResponse(200, { google: true }));
    renderWithQuery(<GoogleButton label="Continue with Google" next="/accept-invitation?token=a" />);
    const link = await screen.findByRole("link", { name: "Continue with Google" });
    expect(link).toHaveAttribute(
      "href",
      `http://api/api/v1/auth/google/start?next=${encodeURIComponent("/accept-invitation?token=a")}`,
    );
  });

  it("stays hidden when Google isn't configured", async () => {
    const mock = mockProviders(jsonResponse(200, { google: false }));
    renderWithQuery(<GoogleButton label="Continue with Google" />);
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("stays hidden if the check fails, leaving password sign-in usable", async () => {
    const mock = mockProviders(errorResponse(500, "server_error"));
    renderWithQuery(<GoogleButton label="Continue with Google" />);
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
