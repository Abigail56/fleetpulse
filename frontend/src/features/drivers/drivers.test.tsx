import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import type { CurrentMembership } from "@/features/organisation/api";
import { clearAuthState } from "@/lib/api/client";

import type { Driver } from "./api";
import { LicenceExpiry } from "./driver-badges";
import { DriverDetail } from "./driver-detail";
import { DriverForm } from "./driver-form";
import { DriverList } from "./driver-list";
import { changedFields, toPayload, toValues } from "./schema";

const navigation = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: vi.fn() }),
  usePathname: () => "/drivers",
  useSearchParams: () => navigation.params,
  useParams: () => ({ id: "d1" }),
}));

const DRIVER: Driver = {
  id: "d1",
  user_id: null,
  first_name: "Tunde",
  last_name: "Adeyemi",
  phone: "+254 712 345678",
  email: "tunde@example.com",
  licence_number: "DL-123456",
  sensitive_visible: true,
  licence_class: "C",
  licence_country_code: "KE",
  licence_expires_on: "2030-01-01",
  status: "active",
  availability: "available",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  current_vehicle: null,
};
const MASKED: Driver = {
  ...DRIVER,
  phone: null,
  email: null,
  licence_number: "••••3456",
  sensitive_visible: false,
};

function membership(permissions: string[]): CurrentMembership {
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
      distance_unit: "km",
    },
  };
}

const MANAGER = membership(["drivers.view", "drivers.manage", "drivers.view_sensitive"]);
const VIEWER = membership(["drivers.view"]);

function mockApi(handler: (path: string, init?: RequestInit) => Response) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace("http://api/api/v1", "");
    if (path === "/auth/me") return jsonResponse(200, { user: {}, csrf_token: "c" });
    if (path.endsWith("/assignments")) return jsonResponse(200, []);
    if (path.startsWith("/vehicles")) {
      return jsonResponse(200, { items: [], total: 0, page: 1, page_size: 25 });
    }
    return handler(path, init);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  navigation.push.mockReset();
  navigation.params = new URLSearchParams();
  window.history.replaceState(null, "", "/drivers");
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("driver form values", () => {
  it("turns blank optional fields into null", () => {
    const payload = toPayload({
      ...toValues(DRIVER),
      phone: "",
      email: "",
      licence_class: "",
      licence_country_code: "",
      licence_expires_on: "",
    });
    expect(payload).toMatchObject({ phone: null, email: null, licence_expires_on: null });
  });

  it("sends only changed fields", () => {
    const values = { ...toValues(DRIVER), phone: "+254 700 000000" };
    expect(changedFields(values, { phone: true })).toEqual({ phone: "+254 700 000000" });
  });
});

describe("LicenceExpiry", () => {
  const today = new Date(2026, 5, 15);

  it.each([
    ["2026-06-14", "Expired"],
    ["2026-06-15", "Expires soon"],
    ["2026-07-15", "Expires soon"],
  ])("%s shows %s", (date, label) => {
    render(<LicenceExpiry date={date} today={today} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows no warning for a distant date, and says when there is none", () => {
    const { rerender } = render(<LicenceExpiry date="2026-07-16" today={today} />);
    expect(screen.queryByText(/Expire/)).not.toBeInTheDocument();
    rerender(<LicenceExpiry date={null} today={today} />);
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
  });
});

describe("DriverList", () => {
  const page = (items: Driver[]) =>
    jsonResponse(200, { items, total: items.length, page: 1, page_size: 25 });

  it("prompts managers for a first driver, and not others", async () => {
    mockApi(() => page([]));
    const { unmount } = renderWithQuery(<DriverList membership={MANAGER} />);
    expect(await screen.findByRole("link", { name: "Add your first driver" })).toBeInTheDocument();
    unmount();
    renderWithQuery(<DriverList membership={VIEWER} />);
    expect(await screen.findByText("No drivers yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Add/ })).not.toBeInTheDocument();
  });

  it("only offers to search what the role may see", async () => {
    mockApi(() => page([]));
    const { unmount } = renderWithQuery(<DriverList membership={MANAGER} />);
    expect(await screen.findByPlaceholderText(/licence, phone or email/)).toBeInTheDocument();
    unmount();
    renderWithQuery(<DriverList membership={VIEWER} />);
    expect(await screen.findByPlaceholderText("Search name")).toBeInTheDocument();
  });

  it("lists drivers and their assignment", async () => {
    mockApi(() =>
      page([{ ...DRIVER, current_vehicle: { id: "v1", registration_number: "KCA 123A" } }]),
    );
    renderWithQuery(<DriverList membership={MANAGER} />);
    expect(await screen.findByRole("link", { name: "Tunde Adeyemi" })).toHaveAttribute(
      "href",
      "/drivers/d1",
    );
    expect(screen.getByText("KCA 123A")).toBeInTheDocument();
    expect(screen.getByText("1 driver")).toBeInTheDocument();
  });

  it("puts filters in the URL", async () => {
    mockApi(() => page([DRIVER]));
    const user = userEvent.setup();
    renderWithQuery(<DriverList membership={MANAGER} />);
    await screen.findByRole("link", { name: "Tunde Adeyemi" });
    await user.selectOptions(screen.getByLabelText("Filter by licence"), "expired");
    expect(window.location.search).toBe("?licence=expired");
  });

  it("shows an error with a retry", async () => {
    mockApi(() => errorResponse(500, "server_error", "Something failed."));
    renderWithQuery(<DriverList membership={MANAGER} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something failed.");
  });
});

describe("DriverForm", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("First name"), "Tunde");
    await user.type(screen.getByLabelText("Last name"), "Adeyemi");
    await user.type(screen.getByLabelText("Licence number"), "dl-123456");
  }

  it("validates before calling the API", async () => {
    const mock = mockApi(() => jsonResponse(201, DRIVER));
    const user = userEvent.setup();
    renderWithQuery(<DriverForm />);
    await user.click(screen.getByRole("button", { name: "Add driver" }));
    expect(await screen.findByText("Please enter a first name.")).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });

  it("creates the driver, opens them, and clears personal data from the form", async () => {
    const mock = mockApi(() => jsonResponse(201, DRIVER));
    const user = userEvent.setup();
    renderWithQuery(<DriverForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Add driver" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/drivers/d1"));
    const create = mock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(create?.[1]?.body)).licence_number).toBe("DL-123456");
    expect(screen.getByLabelText("First name")).toHaveValue("");
  });

  it("puts a duplicate licence error on the field", async () => {
    mockApi(() =>
      errorResponse(409, "duplicate_licence", "Another driver already has this licence number."),
    );
    const user = userEvent.setup();
    renderWithQuery(<DriverForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Add driver" }));
    expect(await screen.findByText(/already has this licence/)).toBeInTheDocument();
    expect(screen.getByLabelText("Licence number")).toHaveAttribute("aria-invalid", "true");
  });

  it("editing sends only the change, with the version it was based on", async () => {
    const mock = mockApi(() => jsonResponse(200, DRIVER));
    const user = userEvent.setup();
    renderWithQuery(<DriverForm driver={DRIVER} />);
    const first = screen.getByLabelText("First name");
    await user.clear(first);
    await user.type(first, "Bola");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const patch = mock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      first_name: "Bola",
      expected_updated_at: DRIVER.updated_at,
    });
  });

  it("explains when someone else edited the record first", async () => {
    mockApi(() =>
      errorResponse(409, "stale_update", "Someone else has changed this driver. Reload and make your change again."),
    );
    const user = userEvent.setup();
    renderWithQuery(<DriverForm driver={DRIVER} />);
    await user.type(screen.getByLabelText("First name"), "x");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else has changed");
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe("DriverDetail", () => {
  it("shows contact details and controls to a manager", async () => {
    mockApi(() => jsonResponse(200, DRIVER));
    renderWithQuery(<DriverDetail membership={MANAGER} />);
    expect(await screen.findByText("+254 712 345678")).toBeInTheDocument();
    expect(screen.getByText("DL-123456")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
  });

  it("says details are hidden for roles without access, with no controls", async () => {
    mockApi(() => jsonResponse(200, MASKED));
    renderWithQuery(<DriverDetail membership={VIEWER} />);
    expect(await screen.findByText(/hidden for your role/)).toBeInTheDocument();
    expect(screen.getByText("••••3456")).toBeInTheDocument();
    expect(screen.queryByText("Phone")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("explains that assigning needs a vehicle first", async () => {
    mockApi(() => jsonResponse(200, DRIVER));
    renderWithQuery(<DriverDetail membership={MANAGER} />);
    expect(await screen.findByText(/Add a vehicle first/)).toBeInTheDocument();
  });

  it("offers unassign when assigned, linking to the vehicle", async () => {
    mockApi(() =>
      jsonResponse(200, {
        ...DRIVER,
        current_vehicle: { id: "v1", registration_number: "KCA 123A" },
      }),
    );
    renderWithQuery(<DriverDetail membership={MANAGER} />);
    expect(await screen.findByRole("link", { name: "KCA 123A" })).toHaveAttribute(
      "href",
      "/vehicles/v1",
    );
    expect(screen.getByRole("button", { name: "Unassign" })).toBeInTheDocument();
  });

  it("doesn't offer assignment to a suspended driver", async () => {
    mockApi(() => jsonResponse(200, { ...DRIVER, status: "suspended" }));
    renderWithQuery(<DriverDetail membership={MANAGER} />);
    expect(await screen.findByText(/Only an active driver/)).toBeInTheDocument();
  });

  it("says plainly when a driver isn't available", async () => {
    mockApi(() => errorResponse(404, "not_found", "Driver not found."));
    renderWithQuery(<DriverDetail membership={MANAGER} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't in this organisation/);
  });
});
