import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import { clearAuthState } from "@/lib/api/client";

import type { Device, LatestPosition } from "./api";
import { DevicesCard } from "./devices-card";
import { IntegrationsCard } from "./integrations-card";
import { PositionCard } from "./position-card";

const POSITION: LatestPosition = {
  vehicle_id: "v1",
  recorded_at: new Date(Date.now() - 60_000).toISOString(),
  received_at: new Date().toISOString(),
  latitude: -1.2921,
  longitude: 36.8219,
  speed_kph: "42.50",
  heading_degrees: "180.00",
  ignition_on: true,
  signal_status: "good",
  is_simulated: false,
  is_stale: false,
};
const DEVICE: Device = {
  id: "d1",
  provider: "generic",
  external_device_id: "IMEI-1",
  vehicle_id: "v1",
  registration_number: "KCA 123A",
  status: "active",
  is_simulated: false,
  last_seen_at: null,
};

function mockApi(routes: Record<string, () => Response>) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace("http://api/api/v1", "").split("?")[0];
    if (path === "/auth/me") return jsonResponse(200, { user: {}, csrf_token: "c" });
    const handler = routes[`${init?.method ?? "GET"} ${path}`] ?? routes[path];
    if (!handler) throw new Error(`Unexpected request: ${path}`);
    return handler();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const VEHICLES = {
  "/vehicles": () =>
    jsonResponse(200, {
      items: [{ id: "v1", registration_number: "KCA 123A" }],
      total: 1,
      page: 1,
      page_size: 25,
    }),
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PositionCard", () => {
  const LATEST = "/tracking/vehicles/v1/latest";

  it("shows the position and how old it is", async () => {
    mockApi({ [LATEST]: () => jsonResponse(200, POSITION) });
    renderWithQuery(<PositionCard vehicleId="v1" />);
    expect(await screen.findByText("-1.29210, 36.82190")).toBeInTheDocument();
    expect(screen.getByText(/1 minute ago/)).toBeInTheDocument();
    expect(screen.getByText("42.5 km/h")).toBeInTheDocument();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
    expect(screen.queryByText("Simulated")).not.toBeInTheDocument();
  });

  it("labels stale and simulated positions", async () => {
    mockApi({
      [LATEST]: () => jsonResponse(200, { ...POSITION, is_stale: true, is_simulated: true }),
    });
    renderWithQuery(<PositionCard vehicleId="v1" />);
    expect(await screen.findByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("Simulated")).toBeInTheDocument();
  });

  it("doesn't turn missing values into zero", async () => {
    mockApi({
      [LATEST]: () =>
        jsonResponse(200, { ...POSITION, speed_kph: null, ignition_on: null, signal_status: "unknown" }),
    });
    renderWithQuery(<PositionCard vehicleId="v1" />);
    await screen.findByText("-1.29210, 36.82190");
    expect(screen.getAllByText("Not reported")).toHaveLength(3);
    expect(screen.queryByText(/0 km\/h/)).not.toBeInTheDocument();
  });

  it("says when nothing has been received", async () => {
    mockApi({ [LATEST]: () => jsonResponse(200, null) });
    renderWithQuery(<PositionCard vehicleId="v1" />);
    expect(await screen.findByText(/No position has been received/)).toBeInTheDocument();
  });

  it("shows errors", async () => {
    mockApi({ [LATEST]: () => errorResponse(500, "server_error", "Something failed.") });
    renderWithQuery(<PositionCard vehicleId="v1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something failed.");
  });
});

describe("IntegrationsCard", () => {
  it("shows a new key once, and never the full key in the list", async () => {
    const key = "fpgps_full-secret-value";
    const item = {
      id: "i1",
      name: "Feed",
      provider: "generic",
      key_prefix: "fpgps_full-s",
      created_at: "2026-01-01T00:00:00Z",
      last_used_at: null,
    };
    let created = false;
    mockApi({
      "/tracking/integrations": () => jsonResponse(200, created ? [item] : []),
      "POST /tracking/integrations": () => {
        created = true;
        return jsonResponse(201, { ...item, key });
      },
    });
    const user = userEvent.setup();
    renderWithQuery(<IntegrationsCard />);
    await user.type(screen.getByLabelText("Feed name"), "Feed");
    await user.click(screen.getByRole("button", { name: "Create key" }));
    expect(await screen.findByText(key)).toBeInTheDocument();
    expect(screen.getByText(/won't be shown again/)).toBeInTheDocument();
    expect(await screen.findByText(/never used/)).toBeInTheDocument();
    expect(screen.getByText("fpgps_full-s…")).toBeInTheDocument();
  });

  it("revoking needs confirmation", async () => {
    const mock = mockApi({
      "/tracking/integrations": () =>
        jsonResponse(200, [
          {
            id: "i1",
            name: "Feed",
            provider: "generic",
            key_prefix: "fpgps_abc",
            created_at: "2026-01-01T00:00:00Z",
            last_used_at: null,
          },
        ]),
      "DELETE /tracking/integrations/i1": () => jsonResponse(204),
    });
    const user = userEvent.setup();
    renderWithQuery(<IntegrationsCard />);
    await user.click(await screen.findByRole("button", { name: "Revoke Feed" }));
    expect(mock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Revoke key" }));
    await waitFor(() =>
      expect(mock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true),
    );
  });
});

describe("DevicesCard", () => {
  const routes = (simulator: boolean, devices: Device[] = []) => ({
    ...VEHICLES,
    "/tracking/devices": () => jsonResponse(200, devices),
    "/tracking/config": () =>
      jsonResponse(200, { simulator_enabled: simulator, stale_minutes: 15 }),
  });

  it("hides the simulator option unless it's enabled", async () => {
    mockApi(routes(false));
    renderWithQuery(<DevicesCard canManage />);
    expect(await screen.findByText("No tracking devices")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Simulated device/)).not.toBeInTheDocument();
  });

  it("offers the simulator when enabled, and needs a vehicle and a start", async () => {
    const mock = mockApi({
      ...routes(true),
      "POST /tracking/devices": () => jsonResponse(201, DEVICE),
    });
    const user = userEvent.setup();
    renderWithQuery(<DevicesCard canManage />);
    await user.click(await screen.findByLabelText(/Simulated device/));
    expect(screen.getByRole("button", { name: "Add device" })).toBeDisabled();
    await screen.findByRole("option", { name: "KCA 123A" });
    await user.selectOptions(screen.getByLabelText("Vehicle"), "v1");
    await user.type(screen.getByLabelText("Starting latitude"), "95");
    await user.type(screen.getByLabelText("Starting longitude"), "36.8");
    expect(screen.getByRole("button", { name: "Add device" })).toBeDisabled();
    await user.clear(screen.getByLabelText("Starting latitude"));
    await user.type(screen.getByLabelText("Starting latitude"), "-1.29");
    await user.click(screen.getByRole("button", { name: "Add device" }));
    await waitFor(() => {
      const post = mock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
        simulated: true,
        vehicle_id: "v1",
        start_latitude: -1.29,
      });
    });
  });

  it("labels simulated devices, and says when nothing has been received", async () => {
    mockApi(routes(false, [{ ...DEVICE, is_simulated: true }]));
    renderWithQuery(<DevicesCard canManage />);
    expect(await screen.findByText("Simulated")).toBeInTheDocument();
    expect(screen.getByText(/nothing received yet/)).toBeInTheDocument();
  });

  it("gives viewers no controls", async () => {
    mockApi(routes(false, [DEVICE]));
    renderWithQuery(<DevicesCard canManage={false} />);
    expect(await screen.findByText("IMEI-1")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
