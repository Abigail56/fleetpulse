import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import type { CurrentMembership } from "@/features/organisation/api";
import { clearAuthState } from "@/lib/api/client";

import type { Trip } from "./api";
import { fromLocalInput, toLocalInput, toPayload, tripSchema } from "./schema";
import { distanceLabel } from "./trip-badges";
import { TripDetail } from "./trip-detail";
import { TripForm } from "./trip-form";
import { TripList } from "./trip-list";

vi.mock("next/navigation", () => ({
  usePathname: () => "/trips",
  useParams: () => ({ id: "t1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => <p>Route map</p> }));

const TRIP: Trip = {
  id: "t1",
  status: "draft",
  origin_name: "Nairobi",
  destination_name: "Mombasa",
  vehicle_id: "v1",
  vehicle_registration: "KCA 123A",
  driver_id: "d1",
  driver_name: "Tunde Adeyemi",
  planned_departure_at: "2030-01-01T08:00:00Z",
  estimated_arrival_at: "2030-01-01T16:00:00Z",
  actual_departure_at: null,
  actual_arrival_at: null,
  distance_km: null,
  distance_source: null,
  dispatch_notes: null,
  created_at: "2030-01-01T00:00:00Z",
  updated_at: "2030-01-01T00:00:00Z",
};
const organisation = { distance_unit: "km" };
const MANAGER = {
  organisation,
  permissions: ["trips.view", "trips.view_all", "trips.manage"],
} as unknown as CurrentMembership;
const DRIVER = { organisation, permissions: ["trips.view"] } as unknown as CurrentMembership;

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

const detail = (trip: Trip) => ({
  "/trips/t1": () => jsonResponse(200, trip),
  "/trips/t1/events": () =>
    jsonResponse(200, [
      { action: "trip.created", occurred_at: "2030-01-01T00:00:00Z", actor_name: "Ada Obi" },
    ]),
  "/trips/t1/route": () => jsonResponse(200, { points: [], is_simulated: false, is_limited: false }),
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("distanceLabel", () => {
  it.each([
    ["gps", /measured from GPS/],
    ["simulated", /simulated test data/],
    ["manual", /entered by hand/],
  ] as const)("says where %s distance came from", (source, label) => {
    expect(distanceLabel({ ...TRIP, distance_km: "12.50", distance_source: source })).toMatch(label);
  });

  it("never shows zero for an unknown distance", () => {
    const label = distanceLabel({ ...TRIP, status: "completed" });
    expect(label).toMatch(/Not available/);
    expect(label).not.toMatch(/0 km/);
  });
});

describe("trip form values", () => {
  const VALID = {
    origin_name: "A",
    destination_name: "B",
    vehicle_id: "",
    driver_id: "",
    planned_departure_at: "",
    estimated_arrival_at: "",
    dispatch_notes: "",
  };

  it("rejects an arrival before the departure", () => {
    const result = tripSchema.safeParse({
      ...VALID,
      planned_departure_at: "2030-01-02T10:00",
      estimated_arrival_at: "2030-01-02T09:00",
    });
    expect(result.success).toBe(false);
  });

  it("sends blanks as null, and only the changed fields when editing", () => {
    expect(toPayload(VALID).vehicle_id).toBeNull();
    expect(toPayload(VALID, ["dispatch_notes"])).toEqual({ dispatch_notes: null });
  });

  it("keeps the same moment through the local time field", () => {
    const iso = "2030-06-01T12:30:00.000Z";
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(fromLocalInput("")).toBeNull();
  });
});

describe("TripList", () => {
  const EMPTY = { items: [], total: 0, page: 1, page_size: 25 };

  it("tells a driver how to get their trips showing", async () => {
    mockApi({ "/trips": () => jsonResponse(200, EMPTY) });
    renderWithQuery(<TripList membership={DRIVER} />);
    expect(screen.getByRole("heading", { name: "My trips" })).toBeVisible();
    expect(await screen.findByText(/link your account/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /New trip/ })).toBeNull();
  });

  it("lets a manager create the first trip", async () => {
    mockApi({ "/trips": () => jsonResponse(200, EMPTY) });
    renderWithQuery(<TripList membership={MANAGER} />);
    expect(await screen.findByRole("link", { name: "Create a trip" })).toBeVisible();
  });

  it("lists trips and shows errors", async () => {
    mockApi({ "/trips": () => jsonResponse(200, { ...EMPTY, items: [TRIP], total: 1 }) });
    const { unmount } = renderWithQuery(<TripList membership={MANAGER} />);
    expect(await screen.findByRole("link", { name: /Nairobi → Mombasa/ })).toBeVisible();
    unmount();
    mockApi({ "/trips": () => errorResponse(500, "server_error", "Something went wrong.") });
    renderWithQuery(<TripList membership={MANAGER} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
  });
});

describe("TripDetail", () => {
  it.each([
    ["draft", "Mark as planned"],
    ["planned", "Dispatch"],
    ["dispatched", "Start trip"],
    ["in_progress", "Complete trip"],
  ] as const)("offers the next step for a %s trip", async (status, label) => {
    const departed = status === "in_progress" ? "2030-01-01T08:00:00Z" : null;
    mockApi(detail({ ...TRIP, status, actual_departure_at: departed }));
    renderWithQuery(<TripDetail membership={MANAGER} />);
    expect(await screen.findByRole("button", { name: label, hidden: false })).toBeVisible();
  });

  it("offers no actions on a finished trip", async () => {
    mockApi(detail({ ...TRIP, status: "completed", actual_departure_at: TRIP.planned_departure_at }));
    renderWithQuery(<TripDetail membership={MANAGER} />);
    await screen.findByRole("heading", { name: /Nairobi/ });
    expect(screen.queryByRole("button", { name: /Cancel trip|Complete|Edit/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
  });

  it("lets a driver start their trip, but not manage it", async () => {
    mockApi(detail({ ...TRIP, status: "dispatched" }));
    renderWithQuery(<TripDetail membership={DRIVER} />);
    expect(await screen.findByRole("button", { name: "Start trip" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel trip" })).toBeNull();
  });

  it("gives no draft-stage controls to a driver", async () => {
    mockApi(detail(TRIP));
    renderWithQuery(<TripDetail membership={DRIVER} />);
    await screen.findByRole("heading", { name: /Nairobi/ });
    expect(screen.queryByRole("button", { name: "Mark as planned" })).toBeNull();
  });

  it("explains a missing route instead of drawing nothing", async () => {
    mockApi(detail({ ...TRIP, status: "in_progress", actual_departure_at: TRIP.planned_departure_at }));
    renderWithQuery(<TripDetail membership={MANAGER} />);
    expect(await screen.findByText(/Not enough GPS positions/)).toBeVisible();
  });

  it("shows who did what", async () => {
    mockApi(detail(TRIP));
    renderWithQuery(<TripDetail membership={MANAGER} />);
    expect(await screen.findByText(/by Ada Obi/)).toBeVisible();
  });

  it("explains a trip the person can't see", async () => {
    mockApi({ "/trips/t1": () => errorResponse(404, "not_found", "Trip not found.") });
    renderWithQuery(<TripDetail membership={DRIVER} />);
    expect(await screen.findByRole("heading", { name: "Trip not found" })).toBeVisible();
  });
});

describe("TripForm", () => {
  const OPTIONS = {
    "/trips/options": () =>
      jsonResponse(200, {
        vehicles: [{ id: "v2", registration_number: "KDB 456B", make: "Volvo", model: "FH" }],
        drivers: [{ id: "d2", name: "Ada Obi" }],
      }),
  };

  it("requires an origin and destination, without calling the API", async () => {
    const mock = mockApi(OPTIONS);
    renderWithQuery(<TripForm />);
    await userEvent.click(screen.getByRole("button", { name: "Create trip" }));
    expect(await screen.findByText("Please enter an origin.")).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("creates a trip", async () => {
    const mock = mockApi({ ...OPTIONS, "POST /trips": () => jsonResponse(201, TRIP) });
    renderWithQuery(<TripForm />);
    await userEvent.type(screen.getByLabelText(/^Origin/), "Nairobi");
    await userEvent.type(screen.getByLabelText(/^Destination/), "Mombasa");
    await screen.findByRole("option", { name: /KDB 456B/ });
    await userEvent.selectOptions(screen.getByLabelText(/^Vehicle/), "v2");
    await userEvent.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => {
      const call = mock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        origin_name: "Nairobi",
        vehicle_id: "v2",
        driver_id: null,
      });
    });
  });

  it("shows a trip's assigned vehicle and driver once the choices have loaded", async () => {
    mockApi({
      "/trips/options": () =>
        jsonResponse(200, {
          vehicles: [{ id: "v1", registration_number: "KCA 123A", make: "Isuzu", model: "NPR" }],
          drivers: [{ id: "d1", name: "Tunde Adeyemi" }],
        }),
    });
    renderWithQuery(<TripForm trip={TRIP} />);
    await screen.findByRole("option", { name: /KCA 123A · Isuzu/ });
    expect(screen.getByLabelText(/^Vehicle/)).toHaveValue("v1");
    expect(screen.getByLabelText(/^Driver/)).toHaveValue("d1");
  });

  it("locks the route and people on a dispatched trip, keeping them visible", async () => {
    mockApi(OPTIONS);
    renderWithQuery(<TripForm trip={{ ...TRIP, status: "dispatched" }} />);
    expect(screen.getByLabelText(/^Origin/)).toBeDisabled();
    expect(screen.getByLabelText(/^Vehicle/)).toBeDisabled();
    expect(screen.getByLabelText(/^Estimated arrival/)).toBeEnabled();
    expect(await screen.findByRole("option", { name: "KCA 123A" })).toBeInTheDocument();
  });
});
