import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import type { CurrentMembership } from "@/features/organisation/api";
import { clearAuthState } from "@/lib/api/client";
import { formatMoney } from "@/lib/money";

import type { Schedule, WorkOrder } from "./api";
import { MaintenanceOverview } from "./maintenance-overview";
import { dueLabel } from "./rows";
import { NewSchedule, ScheduleDetail } from "./schedule-pages";
import {
  completionSchema,
  completionToPayload,
  emptySchedule,
  scheduleSchema,
  scheduleToPayload,
} from "./schema";
import { WorkOrderDetail } from "./work-order-pages";

vi.mock("next/navigation", () => ({
  usePathname: () => "/maintenance",
  useParams: () => ({ id: "x1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const organisation = { distance_unit: "km" };
const MANAGER = {
  organisation,
  permissions: ["maintenance.view", "maintenance.manage"],
} as unknown as CurrentMembership;
const VIEWER = { organisation, permissions: ["maintenance.view"] } as unknown as CurrentMembership;
const MILES = { ...MANAGER, organisation: { distance_unit: "mi" } } as unknown as CurrentMembership;

const SCHEDULE: Schedule = {
  id: "x1",
  vehicle_id: "v1",
  vehicle_registration: "KCA 123A",
  vehicle_odometer_km: "12000.0",
  odometer_recorded_at: new Date().toISOString(),
  name: "Oil change",
  interval_days: 90,
  interval_km: "5000.0",
  warn_days: 14,
  warn_km: "500.0",
  last_service_on: "2030-01-01",
  last_service_km: "10000.0",
  next_due_on: "2030-04-01",
  next_due_km: "15000.0",
  state: "overdue",
  open_work_order_id: null,
  notes: null,
  archived_at: null,
};
const ORDER: WorkOrder = {
  id: "x1",
  vehicle_id: "v1",
  vehicle_registration: "KCA 123A",
  schedule_id: null,
  work_type: "corrective",
  status: "open",
  title: "Replace brake pads",
  description: null,
  scheduled_for: null,
  provider_name: "Nairobi Motors",
  provider_phone: null,
  provider_email: null,
  started_at: null,
  took_off_road: false,
  completed_on: null,
  odometer_km: null,
  labour_cost: null,
  parts_cost: null,
  total_cost: null,
  currency: "KES",
  completion_notes: null,
  created_at: "2030-01-01T00:00:00Z",
};
const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 25 });
const SUMMARY = {
  overdue: 1,
  due_soon: 0,
  open_work_orders: 1,
  in_progress_work_orders: 0,
  recent_costs: [],
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

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("values", () => {
  const VALID = { ...emptySchedule("v1", "km"), name: "Oil", interval_days: "90" };

  it("needs at least one interval", () => {
    expect(scheduleSchema.safeParse(VALID).success).toBe(true);
    expect(scheduleSchema.safeParse({ ...VALID, interval_days: "" }).success).toBe(false);
    expect(
      scheduleSchema.safeParse({ ...VALID, interval_days: "", interval_distance: "5000" }).success,
    ).toBe(true);
  });

  it.each([{ interval_days: "1.5" }, { interval_days: "-1" }, { interval_distance: "0" }])(
    "rejects %j",
    (change) => {
      expect(scheduleSchema.safeParse({ ...VALID, ...change }).success).toBe(false);
    },
  );

  it("leaves blank last-service values for the API to fill in", () => {
    const payload = scheduleToPayload(VALID, "km");
    expect(payload).not.toHaveProperty("last_service_on");
    expect(payload).not.toHaveProperty("last_service_km");
    expect(payload.interval_km).toBeNull();
  });

  it("converts miles to kilometres, which is what's stored", () => {
    const payload = scheduleToPayload({ ...VALID, interval_distance: "100", warn_distance: "10" }, "mi");
    expect(Number(payload.interval_km)).toBeCloseTo(160.9, 1);
    expect(completionToPayload({ completed_on: "", odometer: "100", labour_cost: "", parts_cost: "", completion_notes: "" }, "mi").odometer_km).toBe("160.9");
  });

  it("keeps blank costs out rather than sending zero, but keeps a real zero", () => {
    const blank = { completed_on: "", odometer: "", labour_cost: "", parts_cost: "0", completion_notes: "" };
    expect(completionSchema.safeParse(blank).success).toBe(true);
    const payload = completionToPayload(blank, "km");
    expect(payload).not.toHaveProperty("labour_cost");
    expect(payload.parts_cost).toBe("0.00");
    expect(completionSchema.safeParse({ ...blank, labour_cost: "-5" }).success).toBe(false);
  });

  it("says when a cost wasn't recorded", () => {
    expect(formatMoney(null, "KES")).toBe("Not recorded");
    expect(formatMoney("0", "USD")).toMatch(/0\.00/);
  });

  it("describes both due points, in the organisation's unit", () => {
    expect(dueLabel(SCHEDULE, "km")).toMatch(/1 Apr 2030 or at 15,000 km/);
    expect(dueLabel(SCHEDULE, "mi")).toMatch(/mi/);
  });
});

describe("MaintenanceOverview", () => {
  const ROUTES = {
    "/maintenance/summary": () => jsonResponse(200, SUMMARY),
    "/maintenance/schedules": () => jsonResponse(200, page([SCHEDULE])),
    "/maintenance/work-orders": () => jsonResponse(200, page([ORDER])),
  };

  it("shows what's due, and work orders", async () => {
    mockApi(ROUTES);
    renderWithQuery(<MaintenanceOverview membership={MANAGER} />);
    expect(await screen.findByRole("link", { name: /Oil change.*Overdue/ })).toBeVisible();
    expect(await screen.findByRole("link", { name: /Replace brake pads/ })).toBeVisible();
    expect(await screen.findByText("None recorded")).toBeVisible();
  });

  it("gives viewers no way to create anything", async () => {
    mockApi(ROUTES);
    renderWithQuery(<MaintenanceOverview membership={VIEWER} />);
    await screen.findByRole("link", { name: /Replace brake pads/ });
    expect(screen.queryByRole("link", { name: /New/ })).toBeNull();
  });

  it("explains an empty state, and shows errors without pretending all is well", async () => {
    mockApi({
      ...ROUTES,
      "/maintenance/schedules": () => jsonResponse(200, page([])),
      "/maintenance/work-orders": () => errorResponse(500, "server_error", "Something went wrong."),
    });
    renderWithQuery(<MaintenanceOverview membership={MANAGER} />);
    expect(await screen.findByRole("link", { name: "Create a schedule" })).toBeVisible();
    expect(await screen.findByText("Something went wrong.")).toBeVisible();
    expect(screen.queryByText("No work orders yet.")).toBeNull();
  });
});

describe("ScheduleDetail", () => {
  it("warns when a distance schedule relies on an old reading", async () => {
    mockApi({
      "/maintenance/schedules/x1": () =>
        jsonResponse(200, { ...SCHEDULE, odometer_recorded_at: "2020-01-01T00:00:00Z" }),
    });
    renderWithQuery(<ScheduleDetail membership={MANAGER} />);
    expect(await screen.findByText(/hasn.t\s+been updated recently/)).toBeVisible();
  });

  it("doesn't warn about the odometer for a schedule by date only", async () => {
    mockApi({
      "/maintenance/schedules/x1": () =>
        jsonResponse(200, {
          ...SCHEDULE,
          interval_km: null,
          next_due_km: null,
          odometer_recorded_at: null,
        }),
    });
    renderWithQuery(<ScheduleDetail membership={MANAGER} />);
    await screen.findByRole("heading", { name: "Oil change" });
    expect(screen.queryByText(/updated recently/)).toBeNull();
  });

  it("books new work, or links to what's already booked", async () => {
    mockApi({ "/maintenance/schedules/x1": () => jsonResponse(200, SCHEDULE) });
    const { unmount } = renderWithQuery(<ScheduleDetail membership={MANAGER} />);
    expect(await screen.findByRole("link", { name: "Book this work" })).toHaveAttribute(
      "href",
      "/maintenance/work-orders/new?vehicle=v1&schedule=x1",
    );
    unmount();
    mockApi({
      "/maintenance/schedules/x1": () => jsonResponse(200, { ...SCHEDULE, open_work_order_id: "w9" }),
    });
    renderWithQuery(<ScheduleDetail membership={MANAGER} />);
    expect(await screen.findByRole("link", { name: "View the work order" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Book this work" })).toBeNull();
  });
});

describe("NewSchedule", () => {
  it("labels distance fields in the organisation's unit, and requires a vehicle", async () => {
    const mock = mockApi({ "/maintenance/vehicle-options": () => jsonResponse(200, []) });
    renderWithQuery(<NewSchedule membership={MILES} />);
    expect(screen.getByLabelText(/Every how many mi/)).toBeVisible();
    await userEvent.type(screen.getByLabelText(/^Name/), "Oil");
    await userEvent.type(screen.getByLabelText(/Every how many days/), "90");
    await userEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    expect(await screen.findByText("Please choose a vehicle.")).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
});

describe("WorkOrderDetail", () => {
  const route = (order: WorkOrder) => ({
    "/maintenance/work-orders/x1": () => jsonResponse(200, order),
  });

  it("starts work, taking the vehicle off the road unless told otherwise", async () => {
    const mock = mockApi({
      ...route(ORDER),
      "POST /maintenance/work-orders/x1/start": () =>
        jsonResponse(200, { ...ORDER, status: "in_progress" }),
    });
    renderWithQuery(<WorkOrderDetail membership={MANAGER} />);
    await userEvent.click(await screen.findByRole("button", { name: "Start work" }));
    const confirm = screen.getAllByRole("button", { name: "Start work", hidden: true }).at(-1)!;
    await userEvent.click(confirm);
    await waitFor(() => {
      const call = mock.mock.calls.find(([url]) => String(url).endsWith("/start"));
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ take_off_road: true });
    });
  });

  it("shows the completion form only while in progress", async () => {
    mockApi(route({ ...ORDER, status: "in_progress", started_at: "2030-01-01T08:00:00Z" }));
    renderWithQuery(<WorkOrderDetail membership={MANAGER} />);
    await userEvent.click(await screen.findByRole("button", { name: "Complete work" }));
    expect(screen.getByLabelText(/Labour cost in KES/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(screen.queryByLabelText(/Labour cost/)).toBeNull();
  });

  it("puts the odometer error on the odometer field", async () => {
    mockApi({
      ...route({ ...ORDER, status: "in_progress" }),
      "POST /maintenance/work-orders/x1/complete": () =>
        errorResponse(422, "odometer_required", "Enter the odometer reading."),
    });
    renderWithQuery(<WorkOrderDetail membership={MANAGER} />);
    await userEvent.click(await screen.findByRole("button", { name: "Complete work" }));
    await userEvent.click(screen.getByRole("button", { name: "Complete work order" }));
    expect(await screen.findByText("Enter the odometer reading.")).toBeVisible();
    expect(screen.getByLabelText(/^Odometer/)).toHaveAttribute("aria-invalid", "true");
  });

  it("offers nothing on finished work, and shows unknown costs honestly", async () => {
    mockApi(route({ ...ORDER, status: "completed", completed_on: "2030-02-01" }));
    renderWithQuery(<WorkOrderDetail membership={MANAGER} />);
    await screen.findByRole("heading", { name: "Replace brake pads" });
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancel work order/ })).toBeNull();
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThanOrEqual(3);
  });

  it("gives viewers no actions", async () => {
    mockApi(route(ORDER));
    renderWithQuery(<WorkOrderDetail membership={VIEWER} />);
    await screen.findByRole("heading", { name: "Replace brake pads" });
    expect(screen.queryByRole("button", { name: "Start work" })).toBeNull();
  });
});
