import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import { clearAuthState } from "@/lib/api/client";

import { AdminArea } from "./admin-area";

const SYSTEM = {
  services: [{ name: "File storage", state: "unavailable" }],
  jobs: [{ name: "alerts.sweep", state: "late", last_success_at: "2030-01-01T00:00:00Z" }],
  integrations: [{ name: "Online payment", state: "not_configured", detail: "Nothing can be bought." }],
  counts: {
    organisations: 2,
    users: 3,
    vehicles: 4,
    active_subscriptions: 0,
    emails_waiting: 0,
    emails_failed: 1,
    automation_failed: 0,
    active_gps_feeds: 0,
  },
};
const ORG = {
  id: "o1",
  name: "Swift",
  slug: "swift",
  country_code: "KE",
  status: "active",
  created_at: "2030-01-01T00:00:00Z",
  members: 2,
  vehicles: 3,
  plan: null,
  paid_until: null,
};

function mockApi(routes: Record<string, () => Response>) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace("http://api/api/v1", "").split("?")[0];
    if (path === "/auth/me") return jsonResponse(200, { user: {}, csrf_token: "c" });
    const handler = routes[`${init?.method ?? "GET"} ${path}`] ?? routes[path];
    if (!handler) throw new Error(`Unexpected request: ${init?.method} ${path}`);
    return handler();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const VERIFIED = {
  "/admin/session": () => jsonResponse(200, { verified: true }),
  "/admin/system": () => jsonResponse(200, SYSTEM),
  "/admin/organisations": () =>
    jsonResponse(200, { items: [ORG], total: 1, page: 1, page_size: 25 }),
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AdminArea", () => {
  it("looks like a missing page to anyone who isn't staff", async () => {
    mockApi({ "/admin/session": () => errorResponse(404, "not_found", "Not found.") });
    renderWithQuery(<AdminArea />);
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(screen.queryByText(/Platform administration/)).toBeNull();
  });

  it("asks for a password, and loads nothing until it's given", async () => {
    const mock = mockApi({
      "/admin/session": () => jsonResponse(200, { verified: false }),
      "POST /admin/verify": () => errorResponse(403, "wrong_password", "That password isn't right."),
    });
    renderWithQuery(<AdminArea />);
    await userEvent.type(await screen.findByLabelText(/^Password/), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("That password isn't right.")).toBeVisible();
    expect(mock.mock.calls.some(([url]) => String(url).includes("/admin/system"))).toBe(false);
  });

  it("is honest about what's broken or not set up", async () => {
    mockApi(VERIFIED);
    renderWithQuery(<AdminArea />);
    expect(await screen.findByText("Unavailable")).toBeVisible();
    expect(screen.getByText("Late")).toBeVisible();
    expect(screen.getByText("Not set up")).toBeVisible();
    expect(screen.getByText(/doesn.t prove it works/)).toBeVisible();
  });

  it("won't suspend without a reason, and sends the reason given", async () => {
    const mock = mockApi({
      ...VERIFIED,
      "POST /admin/organisations/o1/suspend": () => jsonResponse(200, null),
    });
    renderWithQuery(<AdminArea />);
    await screen.findByText("Unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Organisations" }));
    await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    const confirm = screen.getAllByRole("button", { name: "Suspend", hidden: true }).at(-1)!;
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^Reason/), "Fraud report 7");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => {
      const call = mock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ reason: "Fraud report 7" });
    });
  });
});
