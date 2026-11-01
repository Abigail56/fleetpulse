import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import type { CurrentMembership } from "@/features/organisation/api";
import { clearAuthState } from "@/lib/api/client";

import type { Vehicle } from "./api";
import { changedFields, EMPTY_VEHICLE, toPayload, toValues } from "./schema";
import { VehicleDetail } from "./vehicle-detail";
import { VehicleForm } from "./vehicle-form";
import { VehicleList } from "./vehicle-list";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
  usePathname: () => "/vehicles",
  useSearchParams: () => navigation.params,
  useParams: () => ({ id: "v1" }),
}));

const VEHICLE: Vehicle = {
  id: "v1",
  registration_number: "KCA 123A",
  make: "Isuzu",
  model: "NPR",
  year: 2021,
  vehicle_type: "truck",
  vin: "VIN12345",
  fuel_type: "diesel",
  odometer_km: "160.9",
  ownership_type: "owned",
  owner_name: null,
  status: "active",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function membership(permissions: string[], unit: "km" | "mi" = "km"): CurrentMembership {
  return {
    role: "owner",
    permissions,
    organisation: {
      id: "o",
      name: "Swift",
      slug: "s",
      country_code: "KE",
      default_currency: "KES",
      timezone: "UTC",
      distance_unit: unit,
    },
  };
}

const MANAGER = membership(["vehicles.view", "vehicles.manage"]);
const VIEWER = membership(["vehicles.view"]);

function mockApi(handler: (path: string, init?: RequestInit) => Response) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace("http://api/api/v1", "");
    if (path === "/auth/me") return jsonResponse(200, { user: {}, csrf_token: "c" });
    if (path.startsWith("/tracking/")) return jsonResponse(200, null);
    return handler(path, init);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const page = (items: Vehicle[], total = items.length) =>
  jsonResponse(200, { items, total, page: 1, page_size: 25 });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  navigation.replace.mockReset();
  window.history.replaceState(null, "", "/vehicles");
  navigation.push.mockReset();
  navigation.params = new URLSearchParams();
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("vehicle form values", () => {
  it("converts miles to stored kilometres", () => {
    const payload = toPayload({ ...EMPTY_VEHICLE, odometer: "100" }, "mi");
    expect(payload.odometer_km).toBe(160.9);
  });

  it("turns blank optional fields into null", () => {
    const payload = toPayload(EMPTY_VEHICLE, "km");
    expect(payload).toMatchObject({ year: null, vin: null, owner_name: null });
  });

  it("sends only changed fields, using the API's names", () => {
    const values = { ...toValues(VEHICLE, "km"), odometer: "200", make: "Toyota" };
    expect(changedFields(values, { odometer: true, make: true }, "km")).toEqual({
      odometer_km: 200,
      make: "Toyota",
    });
  });

  it("shows the odometer in the organisation's unit", () => {
    expect(toValues(VEHICLE, "mi").odometer).toBe("100");
  });
});

describe("VehicleList", () => {
  it("shows a first-vehicle prompt to managers only", async () => {
    mockApi(() => page([]));
    const { unmount } = renderWithQuery(<VehicleList membership={MANAGER} />);
    expect(await screen.findByRole("link", { name: "Add your first vehicle" })).toBeInTheDocument();
    unmount();
    renderWithQuery(<VehicleList membership={VIEWER} />);
    expect(await screen.findByText("No vehicles yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Add/ })).not.toBeInTheDocument();
  });

  it("separates no matches from no vehicles", async () => {
    navigation.params = new URLSearchParams({ search: "zzz" });
    mockApi(() => page([]));
    renderWithQuery(<VehicleList membership={MANAGER} />);
    expect(await screen.findByText("No vehicles match")).toBeInTheDocument();
  });

  it("lists vehicles with their status as text and the org's distance unit", async () => {
    mockApi(() => page([VEHICLE]));
    renderWithQuery(<VehicleList membership={membership(["vehicles.view"], "mi")} />);
    expect(await screen.findByRole("link", { name: "KCA 123A" })).toHaveAttribute(
      "href",
      "/vehicles/v1",
    );
    expect(screen.getAllByText("Active")[0]).toBeInTheDocument();
    expect(screen.getByText("100 mi")).toBeInTheDocument();
  });

  it("sends filters to the API from the URL", async () => {
    navigation.params = new URLSearchParams({ status: "active", page: "2" });
    const mock = mockApi(() => page([VEHICLE], 60));
    renderWithQuery(<VehicleList membership={MANAGER} />);
    await screen.findByRole("link", { name: "KCA 123A" });
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain("status=active");
    expect(url).toContain("page=2");
    expect(screen.getByText(/page 2 of 3/)).toBeInTheDocument();
  });

  it("changing a filter goes back to the first page", async () => {
    navigation.params = new URLSearchParams({ page: "2" });
    mockApi(() => page([VEHICLE], 60));
    const user = userEvent.setup();
    renderWithQuery(<VehicleList membership={MANAGER} />);
    await screen.findByRole("link", { name: "KCA 123A" });
    await user.selectOptions(screen.getByLabelText("Filter by status"), "idle");
    expect(window.location.search).toBe("?status=idle");
  });

  it("waits for typing to stop before searching", async () => {
    mockApi(() => page([VEHICLE]));
    const user = userEvent.setup();
    renderWithQuery(<VehicleList membership={MANAGER} />);
    await screen.findByRole("link", { name: "KCA 123A" });
    await user.type(screen.getByLabelText("Search vehicles"), "abc");
    expect(window.location.search).toBe("");
    await waitFor(() => expect(window.location.search).toBe("?search=abc"));
  });

  it("reports sort order to screen readers and toggles it", async () => {
    mockApi(() => page([VEHICLE]));
    const user = userEvent.setup();
    renderWithQuery(<VehicleList membership={MANAGER} />);
    const header = await screen.findByRole("columnheader", { name: "Registration" });
    expect(header).toHaveAttribute("aria-sort", "ascending");
    await user.click(screen.getByRole("button", { name: "Registration" }));
    expect(window.location.search).toBe("?sort=-registration_number");
  });

  it("shows an error with a retry", async () => {
    mockApi(() => errorResponse(500, "server_error", "Something failed."));
    renderWithQuery(<VehicleList membership={MANAGER} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something failed.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("VehicleForm", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Registration number"), "KCA 123A");
    await user.type(screen.getByLabelText("Make"), "Isuzu");
    await user.type(screen.getByLabelText("Model"), "NPR");
  }

  it("validates before calling the API", async () => {
    const mock = mockApi(() => jsonResponse(201, VEHICLE));
    const user = userEvent.setup();
    renderWithQuery(<VehicleForm unit="km" />);
    await user.click(screen.getByRole("button", { name: "Add vehicle" }));
    expect(await screen.findByText("Please enter the registration number.")).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });

  it("creates the vehicle and opens it", async () => {
    const mock = mockApi(() => jsonResponse(201, VEHICLE));
    const user = userEvent.setup();
    renderWithQuery(<VehicleForm unit="km" />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Add vehicle" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/vehicles/v1"));
    const create = mock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(create?.[1]?.body))).toMatchObject({
      registration_number: "KCA 123A",
      year: null,
    });
  });

  it("puts a duplicate registration error on the field", async () => {
    mockApi(() =>
      errorResponse(409, "duplicate_registration", "Another vehicle already has this registration."),
    );
    const user = userEvent.setup();
    renderWithQuery(<VehicleForm unit="km" />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Add vehicle" }));
    expect(await screen.findByText(/already has this registration/)).toBeInTheDocument();
    expect(screen.getByLabelText("Registration number")).toHaveAttribute("aria-invalid", "true");
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("editing sends only the changed field", async () => {
    const mock = mockApi(() => jsonResponse(200, VEHICLE));
    const user = userEvent.setup();
    renderWithQuery(<VehicleForm vehicle={VEHICLE} unit="km" />);
    const make = screen.getByLabelText("Make");
    await user.clear(make);
    await user.type(make, "Toyota");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const patch = mock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      make: "Toyota",
      expected_updated_at: VEHICLE.updated_at,
    });
  });
});

describe("VehicleDetail", () => {
  it("links to the assigned driver for roles that can view drivers", async () => {
    mockApi(() =>
      jsonResponse(200, { ...VEHICLE, current_driver: { id: "d1", name: "Tunde Adeyemi" } }),
    );
    renderWithQuery(<VehicleDetail membership={membership(["vehicles.view", "drivers.view"])} />);
    expect(await screen.findByRole("link", { name: "Tunde Adeyemi" })).toHaveAttribute(
      "href",
      "/drivers/d1",
    );
  });

  it("offers edit and archive to managers only", async () => {
    mockApi(() => jsonResponse(200, VEHICLE));
    const { unmount } = renderWithQuery(<VehicleDetail membership={MANAGER} />);
    expect(await screen.findByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    unmount();
    renderWithQuery(<VehicleDetail membership={VIEWER} />);
    await screen.findByRole("heading", { name: "KCA 123A" });
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("archiving needs confirmation", async () => {
    const mock = mockApi((_path, init) =>
      init?.method === "POST"
        ? jsonResponse(200, { ...VEHICLE, archived_at: "2026-02-01T00:00:00Z" })
        : jsonResponse(200, VEHICLE),
    );
    const user = userEvent.setup();
    renderWithQuery(<VehicleDetail membership={MANAGER} />);
    await user.click(await screen.findByRole("button", { name: "Archive" }));
    expect(mock.mock.calls.some(([url]) => String(url).endsWith("/archive"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Archive vehicle" }));
    await waitFor(() =>
      expect(mock.mock.calls.some(([url]) => String(url).endsWith("/archive"))).toBe(true),
    );
  });

  it("shows an archived vehicle as archived, offering restore instead of edit", async () => {
    mockApi(() => jsonResponse(200, { ...VEHICLE, archived_at: "2026-02-01T00:00:00Z" }));
    renderWithQuery(<VehicleDetail membership={MANAGER} />);
    expect(await screen.findByRole("button", { name: "Restore vehicle" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("says plainly when a vehicle isn't available", async () => {
    mockApi(() => errorResponse(404, "not_found", "Vehicle not found."));
    renderWithQuery(<VehicleDetail membership={MANAGER} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't in this organisation/);
  });
});
