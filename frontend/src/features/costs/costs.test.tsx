import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import type { CurrentMembership } from "@/features/organisation/api";
import { clearAuthState } from "@/lib/api/client";

import type { Expense, FuelEntry } from "./api";
import { NewExpense, NewFuel } from "./cost-forms";
import { CostsOverview } from "./costs-overview";
import { expenseSchema, fuelSchema, fuelToPayload } from "./schema";
import { VehicleCostsCard } from "./vehicle-costs-card";

vi.mock("next/navigation", () => ({
  usePathname: () => "/costs",
  useParams: () => ({ id: "x1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const organisation = { distance_unit: "km", default_currency: "KES" };
const member = (role: string, permissions: string[]) =>
  ({ organisation, role, permissions }) as unknown as CurrentMembership;
const OWNER = member("owner", ["costs.submit", "costs.view", "costs.approve"]);
const FINANCE = member("finance_manager", ["costs.submit", "costs.view", "costs.approve"]);
const DRIVER = member("driver", ["costs.submit"]);

const EXPENSE: Expense = {
  id: "e1",
  vehicle_id: "v1",
  vehicle_registration: "KCA 123A",
  category: "tolls",
  amount: "500.00",
  currency: "KES",
  incurred_on: "2030-01-05",
  vendor: "Highway Co",
  description: null,
  receipt: null,
  status: "submitted",
  submitted_by_user_id: "someone",
  reviewed_at: null,
  review_note: null,
  voided_at: null,
};
const FUEL: FuelEntry = {
  id: "f1",
  vehicle_id: "v1",
  vehicle_registration: "KCA 123A",
  filled_at: "2030-01-05T08:00:00Z",
  quantity: "40.000",
  unit: "litres",
  unit_price: "200.0000",
  total_cost: "8000.00",
  currency: "KES",
  odometer_km: "1000.0",
  is_full_tank: true,
  station_name: "Shell",
  notes: null,
  receipt: { id: "file1", filename: "receipt.pdf", content_type: "application/pdf", size_bytes: 9 },
  created_by_user_id: "me",
  voided_at: null,
};
const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 25 });
const SUMMARY = {
  start: "2030-01-01",
  end: "2030-01-31",
  totals: [
    { currency: "KES", fuel: "8000", maintenance: "0", expenses: "500", total: "8500" },
    { currency: "USD", fuel: "10", maintenance: "0", expenses: "0", total: "10" },
  ],
  expense_categories: [],
  awaiting_approval: 2,
};

function mockApi(routes: Record<string, () => Response>) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace("http://api/api/v1", "").split("?")[0];
    if (path === "/auth/me") {
      return jsonResponse(200, { user: { id: "me", email: "a@b.c", full_name: "A" }, csrf_token: "c" });
    }
    const handler = routes[`${init?.method ?? "GET"} ${path}`] ?? routes[path];
    if (!handler) throw new Error(`Unexpected request: ${init?.method} ${path}`);
    return handler();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const ROUTES = {
  "/costs/summary": () => jsonResponse(200, SUMMARY),
  "/costs/expenses": () => jsonResponse(200, page([EXPENSE])),
  "/costs/fuel": () => jsonResponse(200, page([FUEL])),
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("values", () => {
  const FUEL_VALUES = {
    vehicle_id: "v1",
    filled_at: "2030-01-05T08:00",
    quantity: "40",
    unit: "litres" as const,
    unit_price: "200",
    currency: "kes",
    odometer: "",
    is_full_tank: false,
    station_name: "",
    notes: "",
  };

  it("makes the currency uppercase, and rejects anything else", () => {
    expect(fuelSchema.parse(FUEL_VALUES).currency).toBe("KES");
    expect(fuelSchema.safeParse({ ...FUEL_VALUES, currency: "Kenya" }).success).toBe(false);
  });

  it.each([{ quantity: "0" }, { quantity: "" }, { unit_price: "-1" }, { odometer: "-5" }, { vehicle_id: "" }])(
    "rejects %j",
    (change) => {
      expect(fuelSchema.safeParse({ ...FUEL_VALUES, ...change }).success).toBe(false);
    },
  );

  it("sends a blank odometer as unknown, and converts miles", () => {
    expect(fuelToPayload(fuelSchema.parse(FUEL_VALUES), "km").odometer_km).toBeNull();
    const miles = fuelSchema.parse({ ...FUEL_VALUES, odometer: "100" });
    expect(fuelToPayload(miles, "mi").odometer_km).toBe("160.9");
  });

  it("requires an expense amount above zero", () => {
    const expense = {
      vehicle_id: "v1",
      category: "tolls",
      amount: "0",
      currency: "KES",
      incurred_on: "2030-01-05",
      vendor: "",
      description: "",
    };
    expect(expenseSchema.safeParse(expense).success).toBe(false);
    expect(expenseSchema.safeParse({ ...expense, amount: "5" }).success).toBe(true);
  });
});

describe("CostsOverview", () => {
  it("keeps currencies apart and says what isn't counted", async () => {
    mockApi(ROUTES);
    renderWithQuery(<CostsOverview membership={OWNER} />);
    expect(await screen.findByText("Total (KES)")).toBeVisible();
    expect(screen.getByText("Total (USD)")).toBeVisible();
    expect(screen.getByText(/never converted/)).toBeVisible();
    expect(screen.getByText(/awaiting approval\s+and not counted/)).toBeVisible();
  });

  it("gives a driver their own records, with no totals or review actions", async () => {
    mockApi({
      "/costs/expenses": () => jsonResponse(200, page([{ ...EXPENSE, submitted_by_user_id: "me" }])),
      "/costs/fuel": () => jsonResponse(200, page([])),
    });
    renderWithQuery(<CostsOverview membership={DRIVER} />);
    expect(screen.getByRole("heading", { name: "My fuel and expenses" })).toBeVisible();
    await screen.findByText(/Highway Co/);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByText("Void")).toBeNull();
    expect(screen.queryByText(/Total \(/)).toBeNull();
    expect(await screen.findByRole("link", { name: /Edit Tolls/ })).toBeVisible();
  });

  it("doesn't offer approval of your own expense, unless you're the owner", async () => {
    const mine = { ...EXPENSE, submitted_by_user_id: "me" };
    mockApi({ ...ROUTES, "/costs/expenses": () => jsonResponse(200, page([mine])) });
    const { unmount } = renderWithQuery(<CostsOverview membership={FINANCE} />);
    await screen.findByText(/Highway Co/);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Approve" })).toBeNull());
    unmount();
    renderWithQuery(<CostsOverview membership={OWNER} />);
    expect(await screen.findByRole("button", { name: "Approve" })).toBeVisible();
  });

  it("approves someone else's expense", async () => {
    const mock = mockApi({ ...ROUTES, "POST /costs/expenses/e1/approve": () => jsonResponse(200, EXPENSE) });
    renderWithQuery(<CostsOverview membership={FINANCE} />);
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(mock.mock.calls.some(([url]) => String(url).endsWith("/approve"))).toBe(true),
    );
  });

  it("gets a fresh link for a receipt only when it's asked for", async () => {
    const mock = mockApi({
      ...ROUTES,
      "/files/file1/link": () => errorResponse(503, "storage_unavailable", "File storage isn't available."),
    });
    renderWithQuery(<CostsOverview membership={OWNER} />);
    const link = await screen.findByRole("button", { name: "Download receipt.pdf" });
    expect(mock.mock.calls.some(([url]) => String(url).includes("/files/"))).toBe(false);
    await userEvent.click(link);
    await waitFor(() =>
      expect(mock.mock.calls.some(([url]) => String(url).includes("/files/file1/link"))).toBe(true),
    );
  });

  it("shows errors rather than empty states", async () => {
    mockApi({
      ...ROUTES,
      "/costs/expenses": () => errorResponse(500, "server_error", "Expenses failed."),
    });
    renderWithQuery(<CostsOverview membership={OWNER} />);
    expect(await screen.findByText("Expenses failed.")).toBeVisible();
    expect(screen.queryByText("No expenses yet")).toBeNull();
  });
});

describe("forms", () => {
  const OPTIONS = {
    "/costs/options": () =>
      jsonResponse(200, {
        vehicles: [{ id: "v1", registration_number: "KCA 123A", make: "Isuzu", model: "NPR" }],
        default_currency: "NGN",
      }),
  };

  it("starts with the organisation's currency, without assuming one", async () => {
    mockApi(OPTIONS);
    renderWithQuery(<NewFuel membership={OWNER} />);
    await waitFor(() => expect(screen.getByLabelText(/^Currency/)).toHaveValue("NGN"));
  });

  it("tells a driver with no assigned vehicle why they can't choose one", async () => {
    mockApi({
      "/costs/options": () => jsonResponse(200, { vehicles: [], default_currency: "KES" }),
    });
    renderWithQuery(<NewExpense />);
    expect(await screen.findByText("No vehicle is assigned to you yet.")).toBeVisible();
  });

  it("rejects an oversized receipt without uploading it", async () => {
    const mock = mockApi(OPTIONS);
    renderWithQuery(<NewExpense />);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/^Receipt/), big);
    expect(await screen.findByText("Files can be up to 10 MB.")).toBeVisible();
    expect(mock.mock.calls.some(([url]) => String(url).endsWith("/files"))).toBe(false);
  });
});

describe("VehicleCostsCard", () => {
  const costs = (extra: object) => ({
    "/costs/vehicles/v1": () =>
      jsonResponse(200, {
        start: "2030-01-01",
        end: "2030-01-31",
        distance_km: null,
        readings: 0,
        costs: [{ currency: "KES", total: "8000", cost_per_km: null }],
        consumption: [],
        ...extra,
      }),
  });

  it("explains why there's no rate, rather than showing zero", async () => {
    mockApi(costs({ readings: 1 }));
    renderWithQuery(<VehicleCostsCard vehicleId="v1" unit="km" canSubmit={false} />);
    expect(await screen.findByText(/needs at least two different odometer readings/)).toBeVisible();
    expect(screen.queryByText(/per km$/)).toBeNull();
  });

  it("shows the rate and how it was measured", async () => {
    mockApi(
      costs({
        distance_km: "500.0",
        readings: 2,
        costs: [{ currency: "KES", total: "8000", cost_per_km: "16.0000" }],
        consumption: [{ unit: "litres", per_100_km: "10.0000", distance_km: "500.0" }],
      }),
    );
    renderWithQuery(<VehicleCostsCard vehicleId="v1" unit="km" canSubmit={false} />);
    expect(await screen.findByText(/per km/)).toBeVisible();
    expect(screen.getByText(/measured from\s+2 odometer readings/)).toBeVisible();
    expect(screen.getByText(/10 litres per 100 km/)).toBeVisible();
  });
});
