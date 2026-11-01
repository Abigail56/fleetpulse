import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import {
  EMPTY_GEOFENCE,
  geofenceSchema,
  parseBoundary,
  previewBoundary,
  toPayload,
  toValues,
} from "@/features/geofences/schema";
import type { Geofence } from "@/features/geofences/api";
import { GeofenceForm } from "@/features/geofences/geofence-form";
import { GeofenceList } from "@/features/geofences/geofence-list";
import type { CurrentMembership } from "@/features/organisation/api";
import { clearAuthState } from "@/lib/api/client";

import { AlertList } from "./alert-list";
import type { AlertItem } from "./api";

vi.mock("next/navigation", () => ({
  usePathname: () => "/alerts",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => <p>Map</p> }));

const MANAGER = {
  permissions: ["alerts.view", "alerts.manage", "geofences.view", "geofences.manage"],
} as CurrentMembership;
const VIEWER = { permissions: ["alerts.view", "geofences.view"] } as CurrentMembership;
const ALERT: AlertItem = {
  id: "a1",
  alert_type: "geofence_entry",
  severity: "critical",
  title: "KCA 123A entered Quarry",
  message: "KCA 123A entered restricted area Quarry.",
  occurred_at: "2030-01-01T08:00:00Z",
  vehicle_id: "v1",
  vehicle_registration: "KCA 123A",
  driver_id: null,
  geofence_id: "g1",
  is_simulated: false,
  acknowledged_at: null,
  resolved_at: null,
};
const SETTINGS = {
  speed_limit_kph: null,
  offline_alerts_enabled: true,
  offline_minutes: 60,
  licence_alerts_enabled: true,
  maintenance_alerts_enabled: true,
  document_alerts_enabled: true,
};
const page = (items: AlertItem[]) => ({ items, total: items.length, page: 1, page_size: 25 });

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

const ROUTES = {
  "/alerts": () => jsonResponse(200, page([ALERT])),
  "/alerts/settings": () => jsonResponse(200, SETTINGS),
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseBoundary", () => {
  it("reads one pair per line, with commas or spaces", () => {
    expect(parseBoundary("-1.2, 36.8\n\n-1.3 36.9\n")).toEqual([
      [-1.2, 36.8],
      [-1.3, 36.9],
    ]);
  });

  it.each(["abc", "1", "1,2,3", "91, 0", "0, 181", "1, x"])("rejects %j", (text) => {
    expect(parseBoundary(text)).toBeNull();
  });
});

describe("geofenceSchema", () => {
  const circle = {
    ...EMPTY_GEOFENCE,
    name: "Yard",
    center_latitude: "-1.2",
    center_longitude: "36.8",
  };

  it("accepts a complete circle", () => {
    expect(geofenceSchema.safeParse(circle).success).toBe(true);
    expect(toPayload(circle)).toMatchObject({ kind: "circle", center_latitude: -1.2, radius_m: 500 });
  });

  it.each([
    ["no centre", { center_latitude: "" }],
    ["latitude out of range", { center_latitude: "95" }],
    ["radius too small", { radius_m: "5" }],
    ["no name", { name: " " }],
  ])("rejects a circle with %s", (_label, change) => {
    expect(geofenceSchema.safeParse({ ...circle, ...change }).success).toBe(false);
  });

  it("needs at least three readable corners", () => {
    const polygon = { ...circle, kind: "polygon" as const };
    expect(geofenceSchema.safeParse({ ...polygon, boundary: "0,0\n0,1" }).success).toBe(false);
    expect(geofenceSchema.safeParse({ ...polygon, boundary: "0,0\n0,1\nx" }).success).toBe(false);
    expect(geofenceSchema.safeParse({ ...polygon, boundary: "0,0\n0,1\n1,1" }).success).toBe(true);
  });

  it("previews a circle around its centre, and nothing before there is one", () => {
    const points = previewBoundary(circle);
    expect(points.length).toBeGreaterThan(8);
    expect(points[0][0]).toBeCloseTo(-1.2, 1);
    expect(previewBoundary(EMPTY_GEOFENCE)).toEqual([]);
  });

  it("restores a saved polygon without its repeated last corner", () => {
    const saved = {
      kind: "polygon",
      boundary: [
        [0, 0],
        [0, 1],
        [1, 1],
        [0, 0],
      ],
    } as Geofence;
    expect(toValues(saved).boundary.split("\n")).toHaveLength(3);
  });
});

describe("AlertList", () => {
  it("lets a manager acknowledge, and refreshes", async () => {
    const mock = mockApi({
      ...ROUTES,
      "POST /alerts/a1/acknowledge": () => jsonResponse(200, ALERT),
    });
    renderWithQuery(<AlertList membership={MANAGER} />);
    await userEvent.click(await screen.findByRole("button", { name: /Acknowledge: KCA 123A/ }));
    await waitFor(() =>
      expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true),
    );
  });

  it("gives viewers no action buttons or editable settings", async () => {
    mockApi(ROUTES);
    renderWithQuery(<AlertList membership={VIEWER} />);
    await screen.findByText("KCA 123A entered Quarry");
    expect(screen.queryByRole("button", { name: /Acknowledge/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Resolve/ })).toBeNull();
    expect(await screen.findByLabelText(/Speed limit/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
  });

  it("labels simulated alerts, and only those", async () => {
    mockApi({ ...ROUTES, "/alerts": () => jsonResponse(200, page([{ ...ALERT, is_simulated: true }])) });
    const { unmount } = renderWithQuery(<AlertList membership={VIEWER} />);
    const list = await screen.findByRole("list", { name: "Alerts" });
    expect(within(list).getByText("Simulated")).toBeVisible();
    unmount();
    mockApi(ROUTES);
    renderWithQuery(<AlertList membership={VIEWER} />);
    await screen.findByText("KCA 123A entered Quarry");
    expect(screen.queryByText("Simulated")).toBeNull();
  });

  it("offers no actions on a resolved alert", async () => {
    mockApi({
      ...ROUTES,
      "/alerts": () => jsonResponse(200, page([{ ...ALERT, resolved_at: "2030-01-01T09:00:00Z" }])),
    });
    renderWithQuery(<AlertList membership={MANAGER} />);
    await screen.findByText("KCA 123A entered Quarry");
    expect(screen.queryByRole("button", { name: /Resolve:/ })).toBeNull();
  });

  it("doesn't claim everything is fine when alerts fail to load", async () => {
    mockApi({
      ...ROUTES,
      "/alerts": () => errorResponse(500, "server_error", "Something went wrong."),
    });
    renderWithQuery(<AlertList membership={MANAGER} />);
    expect(await screen.findByText("Something went wrong.")).toBeVisible();
    expect(screen.queryByText("No active alerts")).toBeNull();
  });

  it("validates and saves settings, with a blank limit meaning off", async () => {
    const mock = mockApi({
      ...ROUTES,
      "PATCH /alerts/settings": () => jsonResponse(200, SETTINGS),
    });
    renderWithQuery(<AlertList membership={MANAGER} />);
    const speed = await screen.findByLabelText(/Speed limit/);
    await userEvent.type(speed, "999");
    expect(screen.getByText(/whole number from 1 to 400/)).toBeVisible();
    await userEvent.clear(speed);
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => {
      const call = mock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(JSON.parse(String(call?.[1]?.body)).speed_limit_kph).toBeNull();
    });
  });
});

describe("Geofences", () => {
  it("explains an empty list, and only managers can start one", async () => {
    mockApi({ "/geofences": () => jsonResponse(200, []) });
    const { unmount } = renderWithQuery(<GeofenceList membership={MANAGER} />);
    expect(await screen.findByRole("link", { name: "Create a geofence" })).toBeVisible();
    unmount();
    renderWithQuery(<GeofenceList membership={VIEWER} />);
    await screen.findByText("No geofences yet");
    expect(screen.queryByRole("link", { name: /geofence/i })).toBeNull();
  });

  it("switches between circle and polygon fields, and blocks an incomplete shape", async () => {
    const mock = mockApi({ "/tracking/fleet": () => jsonResponse(200, []) });
    renderWithQuery(<GeofenceForm />);
    expect(screen.getByLabelText(/Centre latitude/)).toBeVisible();
    await userEvent.click(screen.getByLabelText("Polygon"));
    expect(screen.queryByLabelText(/Centre latitude/)).toBeNull();
    await userEvent.type(screen.getByLabelText(/^Name/), "Yard");
    await userEvent.click(screen.getByRole("button", { name: "Create geofence" }));
    expect(await screen.findByText(/needs 3 to 200/)).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("still works when the fleet can't be loaded to position the map", async () => {
    mockApi({
      "/tracking/fleet": () => errorResponse(403, "forbidden", "No."),
      "POST /geofences": () => jsonResponse(201, { id: "g1" }),
    });
    renderWithQuery(<GeofenceForm />);
    await userEvent.type(screen.getByLabelText(/^Name/), "Yard");
    await userEvent.type(screen.getByLabelText(/Centre latitude/), "0");
    await userEvent.type(screen.getByLabelText(/Centre longitude/), "0");
    await userEvent.click(screen.getByRole("button", { name: "Create geofence" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
