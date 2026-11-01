import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import { clearAuthState } from "@/lib/api/client";

import type { BillingStatus, Payment, Plan } from "./api";
import { Billing } from "./billing";

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/billing",
  useSearchParams: () => new URLSearchParams(search.value),
}));

const STATUS: BillingStatus = {
  payments_enabled: false,
  enforced: false,
  state: "trial",
  plan: null,
  trial_ends_at: "2030-01-15T00:00:00Z",
  paid_until: null,
  vehicles_paid_for: 0,
  vehicles_used: 3,
  members_used: 2,
  max_vehicles: 25,
  max_members: 5,
};
const PLANS: Plan[] = [
  { key: "starter", name: "Starter", price_per_vehicle: "9.00", currency: "USD", max_vehicles: 2, max_members: 5 },
  { key: "growth", name: "Growth", price_per_vehicle: "15.00", currency: "USD", max_vehicles: 250, max_members: null },
];
const PAYMENT: Payment = {
  id: "p1",
  reference: "fp_abc",
  plan: "growth",
  vehicles: 3,
  amount: "45.00",
  currency: "USD",
  status: "pending",
  created_at: "2030-01-01T00:00:00Z",
  paid_at: null,
};

function mockApi(overrides: Record<string, () => Response> = {}) {
  const routes: Record<string, () => Response> = {
    "/billing/status": () => jsonResponse(200, STATUS),
    "/billing/plans": () => jsonResponse(200, PLANS),
    "/billing/payments": () => jsonResponse(200, []),
    ...overrides,
  };
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

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  clearAuthState();
  search.value = "";
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Billing", () => {
  it("says plainly when payment isn't set up, and offers no button that would fail", async () => {
    mockApi();
    renderWithQuery(<Billing />);
    expect(await screen.findByText(/Online payment isn.t set up yet/)).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Growth" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Pay for/ })).toBeNull();
  });

  it("offers checkout when set up, but not for a plan too small for the fleet", async () => {
    mockApi({ "/billing/status": () => jsonResponse(200, { ...STATUS, payments_enabled: true }) });
    renderWithQuery(<Billing />);
    expect(await screen.findByRole("button", { name: "Pay for Growth" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Too small for your fleet" })).toBeDisabled();
  });

  it("shows a checkout failure, and stays on the page", async () => {
    const mock = mockApi({
      "/billing/status": () => jsonResponse(200, { ...STATUS, payments_enabled: true }),
      "POST /billing/checkout": () => errorResponse(503, "payment_unavailable", "Payment isn't available."),
    });
    renderWithQuery(<Billing />);
    await userEvent.click(await screen.findByRole("button", { name: "Pay for Growth" }));
    await waitFor(() =>
      expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true),
    );
  });

  it("doesn't treat coming back from the payment page as being paid", async () => {
    search.value = "reference=fp_abc";
    mockApi({ "/billing/payments": () => jsonResponse(200, [PAYMENT]) });
    renderWithQuery(<Billing />);
    expect(await screen.findByText(/waiting for the payment provider to confirm/)).toBeVisible();
    expect(screen.queryByText(/Payment confirmed/)).toBeNull();
    expect(await screen.findByText("Not confirmed")).toBeVisible();
  });

  it("confirms only when the record says it's paid", async () => {
    search.value = "reference=fp_abc";
    mockApi({
      "/billing/payments": () => jsonResponse(200, [{ ...PAYMENT, status: "paid", paid_at: "2030-01-01T00:00:00Z" }]),
    });
    renderWithQuery(<Billing />);
    expect(await screen.findByText(/Payment confirmed/)).toBeVisible();
    expect(screen.queryByText(/waiting for the payment provider/)).toBeNull();
  });

  it.each([
    ["failed", /didn.t go through/],
    ["mismatched", /didn.t match what was due/],
  ] as const)("explains a %s payment", async (status, text) => {
    search.value = "reference=fp_abc";
    mockApi({ "/billing/payments": () => jsonResponse(200, [{ ...PAYMENT, status }]) });
    renderWithQuery(<Billing />);
    expect(await screen.findByText(text)).toBeVisible();
  });

  it("reassures someone whose subscription ended that their data is safe", async () => {
    mockApi({
      "/billing/status": () => jsonResponse(200, { ...STATUS, state: "expired", enforced: true, trial_ends_at: null }),
    });
    renderWithQuery(<Billing />);
    expect(await screen.findByText(/Your data is safe/)).toBeVisible();
    expect(screen.getByText("Ended")).toBeVisible();
  });

  it("shows an error with a retry", async () => {
    mockApi({ "/billing/status": () => errorResponse(500, "server_error", "It failed.") });
    renderWithQuery(<Billing />);
    expect(await screen.findByText("It failed.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
