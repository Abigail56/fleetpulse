import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import type { FleetVehicleRow } from "@/features/tracking/api";
import { clearAuthState } from "@/lib/api/client";

import { deriveStatus, matchesSearch, toLiveVehicle } from "./fleet-status";
import { LiveMap } from "./live-map";
import { applyPositions, type StreamPosition } from "./use-live-fleet";

vi.mock("next/navigation", () => ({
  usePathname: () => "/map",
  useSearchParams: () => new URLSearchParams(),
}));
// WebGL isn't available in tests. The real canvas is covered by the browser tests.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Canvas({ vehicles }: { vehicles: { registration: string }[] }) {
      return <p data-testid="map">{vehicles.map((item) => item.registration).join(",")}</p>;
    },
}));

const NOW = new Date("2026-06-01T12:00:00Z").getTime();
const LIMITS = { staleMinutes: 15, offlineMinutes: 1440 };
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function row(overrides: Partial<FleetVehicleRow> = {}): FleetVehicleRow {
  return {
    id: "v1",
    registration_number: "KCA 123A",
    make: "Isuzu",
    model: "NPR",
    vehicle_status: "active",
    recorded_at: minutesAgo(1),
    latitude: -1.2921,
    longitude: 36.8219,
    speed_kph: "42.50",
    heading_degrees: "90.00",
    ignition_on: true,
    signal_status: "good",
    is_simulated: false,
    driver_name: null,
    ...overrides,
  };
}

const NEVER: Partial<FleetVehicleRow> = {
  id: "v2",
  registration_number: "NEVER 1",
  recorded_at: null,
  latitude: null,
  longitude: null,
  speed_kph: null,
  heading_degrees: null,
  ignition_on: null,
  signal_status: null,
};

describe("deriveStatus", () => {
  const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
  const status = (fields: Partial<FleetVehicleRow>) =>
    deriveStatus({ recorded_at: at(1), speed_kph: null, ignition_on: null, ...fields }, NOW, LIMITS);

  it("uses the reported speed", () => {
    expect(status({ speed_kph: "40" })).toBe("moving");
    expect(status({ speed_kph: "0" })).toBe("idle");
    expect(status({ speed_kph: "2.9" })).toBe("idle");
    expect(status({ speed_kph: "3" })).toBe("moving");
  });

  it("never treats an unknown speed as stopped", () => {
    expect(status({ speed_kph: null, ignition_on: true })).toBe("unknown");
    expect(status({ speed_kph: null, ignition_on: null })).toBe("unknown");
    expect(status({ speed_kph: null, ignition_on: false })).toBe("idle");
  });

  it("lets age override what the vehicle last said", () => {
    expect(status({ recorded_at: at(15), speed_kph: "40" })).toBe("moving");
    expect(status({ recorded_at: at(16), speed_kph: "40" })).toBe("stale");
    expect(status({ recorded_at: at(1441), speed_kph: "40" })).toBe("offline");
  });

  it("recognises a vehicle that never reported", () => {
    expect(status({ recorded_at: null })).toBe("no_position");
  });
});

describe("toLiveVehicle", () => {
  it("keeps a missing position and speed missing, rather than zero", () => {
    const vehicle = toLiveVehicle(row(NEVER), NOW, LIMITS);
    expect(vehicle.position).toBeNull();
    expect(vehicle.speedKph).toBeNull();
    expect(vehicle.secondsSinceUpdate).toBeNull();
  });

  it("does not show a negative age if a device clock runs ahead", () => {
    const vehicle = toLiveVehicle(row({ recorded_at: new Date(NOW + 5000).toISOString() }), NOW, LIMITS);
    expect(vehicle.secondsSinceUpdate).toBe(0);
  });
});

describe("matchesSearch", () => {
  const vehicle = toLiveVehicle(row({ driver_name: "Tunde Adeyemi" }), NOW, LIMITS);
  it.each(["kca", "  ISUZU ", "npr", "tunde", ""])("finds %j", (term) => {
    expect(matchesSearch(vehicle, term)).toBe(true);
  });
  it("rejects anything else", () => expect(matchesSearch(vehicle, "volvo")).toBe(false));
});

describe("applyPositions", () => {
  const update = (recorded_at: string, speed = "9"): StreamPosition => ({
    vehicle_id: "v1",
    recorded_at,
    latitude: 1,
    longitude: 2,
    speed_kph: speed,
    heading_degrees: null,
    ignition_on: null,
    signal_status: "good",
    is_simulated: false,
  });

  it("applies a newer position", () => {
    const [result] = applyPositions([row({ recorded_at: minutesAgo(5) })], [update(minutesAgo(1))]);
    expect(result.latitude).toBe(1);
    expect(result.registration_number).toBe("KCA 123A");
  });

  it("ignores an older or repeated position", () => {
    const current = row({ recorded_at: minutesAgo(1) });
    expect(applyPositions([current], [update(minutesAgo(5))])[0]).toBe(current);
    expect(applyPositions([current], [update(current.recorded_at!)])[0]).toBe(current);
  });

  it("fills in a vehicle's first position", () => {
    const [result] = applyPositions([row({ ...NEVER, id: "v1" })], [update(minutesAgo(1))]);
    expect(result.recorded_at).not.toBeNull();
  });
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  close() {}
  receive(message: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }
}

function mockApi(fleet: () => Response) {
  const mock = vi.fn(async (url: string) => {
    const path = String(url).replace("http://api/api/v1", "").split("?")[0];
    if (path === "/auth/me") return jsonResponse(200, { user: {}, csrf_token: "c" });
    if (path === "/tracking/config") {
      return jsonResponse(200, { simulator_enabled: false, stale_minutes: 15, offline_minutes: 1440 });
    }
    if (path === "/tracking/fleet") return fleet();
    if (path.endsWith("/history")) return jsonResponse(200, []);
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const show = (props: Partial<Parameters<typeof LiveMap>[0]> = {}) =>
  renderWithQuery(<LiveMap canManage canViewDrivers {...props} />);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("LiveMap", () => {
  it("connects to the stream over the matching secure scheme", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.com");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, [])));
    show();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(FakeSocket.instances[0].url).toBe("wss://api.example.com/api/v1/tracking/stream");
  });

  it("offers to add a vehicle to an empty fleet, only to those who can", async () => {
    mockApi(() => jsonResponse(200, []));
    const { unmount } = show();
    expect(await screen.findByRole("link", { name: "Add a vehicle" })).toBeVisible();
    unmount();
    show({ canManage: false });
    expect(await screen.findByText("No vehicles yet")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Add a vehicle" })).toBeNull();
  });

  it("explains a fleet with no positions, instead of showing an empty map as if it were fine", async () => {
    mockApi(() => jsonResponse(200, [row(NEVER)]));
    show();
    expect(await screen.findByText(/None of your vehicles has reported/)).toBeVisible();
    expect(screen.getByText("No position yet")).toBeVisible();
  });

  it("shows an error with a way to retry when the fleet can't load", async () => {
    mockApi(() => errorResponse(500, "server_error", "Something went wrong."));
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("labels simulated data", async () => {
    mockApi(() => jsonResponse(200, [row({ is_simulated: true })]));
    show();
    expect(await screen.findByText(/All of these positions are simulated/)).toBeVisible();
    expect(screen.getByText(/· Simulated/)).toBeVisible();
  });

  it("doesn't call real data simulated", async () => {
    mockApi(() => jsonResponse(200, [row()]));
    show();
    await screen.findByRole("list", { name: "Vehicles" });
    expect(screen.queryByText(/simulated/i)).toBeNull();
  });

  it("marks an old position and warns the vehicle may have moved", async () => {
    mockApi(() => jsonResponse(200, [row({ recorded_at: minutesAgo(90) })]));
    show();
    await userEvent.click(await screen.findByRole("button", { name: /KCA 123A/ }));
    expect(screen.getByText(/1 hr ago. The vehicle may have moved/)).toBeVisible();
    expect(screen.getByText("42.5 km/h when last reported")).toBeVisible();
  });

  it("says when a detail wasn't reported, rather than showing zero", async () => {
    mockApi(() =>
      jsonResponse(200, [
        row({ speed_kph: null, heading_degrees: null, ignition_on: null, signal_status: "unknown" }),
      ]),
    );
    show();
    await userEvent.click(await screen.findByRole("button", { name: /KCA 123A/ }));
    const details = screen.getByRole("region", { name: "KCA 123A details" });
    expect(within(details).getAllByText("Not reported")).toHaveLength(4);
    expect(within(details).queryByText(/0 km\/h/)).toBeNull();
  });

  it("hides the driver row from roles that can't view drivers", async () => {
    mockApi(() => jsonResponse(200, [row()]));
    show({ canViewDrivers: false });
    await userEvent.click(await screen.findByRole("button", { name: /KCA 123A/ }));
    expect(screen.queryByText("Driver")).toBeNull();
  });

  it("filters the list and the map together", async () => {
    mockApi(() =>
      jsonResponse(200, [row(), row({ id: "v2", registration_number: "KDB 456B", make: "Volvo" })]),
    );
    show();
    const search = await screen.findByLabelText("Search");
    await userEvent.type(search, "volvo");
    expect(screen.getByTestId("map")).toHaveTextContent(/^KDB 456B$/);
    expect(screen.queryByRole("button", { name: /KCA 123A/ })).toBeNull();
    await userEvent.type(search, "zzz");
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: /KCA 123A/ })).toBeVisible();
  });

  it("updates a vehicle from the stream and reports the connection honestly", async () => {
    mockApi(() => jsonResponse(200, [row({ speed_kph: "0", recorded_at: minutesAgo(2) })]));
    show();
    const list = await screen.findByRole("list", { name: "Vehicles" });
    expect(within(list).getByText("Idle")).toBeVisible();
    expect(screen.getByText("Connecting…")).toBeVisible();
    const socket = FakeSocket.instances[0];
    socket.receive({ type: "ready" });
    expect(screen.getByText("Live")).toBeVisible();
    socket.receive({
      type: "positions",
      positions: [
        {
          vehicle_id: "v1",
          recorded_at: new Date().toISOString(),
          latitude: 1,
          longitude: 2,
          speed_kph: "50.00",
          heading_degrees: null,
          ignition_on: true,
          signal_status: "good",
          is_simulated: false,
        },
      ],
    });
    expect(await within(list).findByText("Moving")).toBeVisible();
    act(() => socket.onclose?.({ code: 1006 }));
    expect(screen.getByText(/Live updates paused/)).toBeVisible();
  });

  it("does not reconnect after access is taken away", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockApi(() => jsonResponse(200, [row()]));
      show();
      await screen.findByRole("list", { name: "Vehicles" });
      act(() => FakeSocket.instances[0].onclose?.({ code: 4403 }));
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(FakeSocket.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnects after a dropped connection, renewing the session first", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const mock = mockApi(() => jsonResponse(200, [row()]));
      show();
      await screen.findByRole("list", { name: "Vehicles" });
      act(() => FakeSocket.instances[0].onclose?.({ code: 1006 }));
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(mock.mock.calls.some(([url]) => String(url).endsWith("/auth/me"))).toBe(true);
      expect(FakeSocket.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
