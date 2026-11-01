import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/features/dashboard/dashboard-view";
import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import type { CurrentMembership, Member, Organisation } from "@/features/organisation/api";
import { Invitations } from "@/features/organisation/invitations";
import { MembersTable } from "@/features/organisation/members-table";
import { RequireOrganisation } from "@/features/organisation/require-organisation";
import { clearAuthState } from "@/lib/api/client";

import { AppShell } from "./app-shell";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const sessionChange = vi.hoisted(() => ({
  changeSession: vi.fn(),
  subscribeToSessionChanges: vi.fn(() => () => {}),
}));

vi.mock("@/lib/session-change", () => sessionChange);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  usePathname: () => "/dashboard",
}));

const ORG: Organisation = {
  id: "org-1",
  name: "Swift Logistics",
  slug: "swift",
  country_code: "KE",
  default_currency: "KES",
  timezone: "UTC",
  distance_unit: "km",
};
const USER = { id: "me", email: "ada@example.com", full_name: "Ada Obi" };

function membership(role: CurrentMembership["role"], permissions: string[]): CurrentMembership {
  return { organisation: ORG, role, permissions };
}

const OWNER = membership("owner", ["organisation.view", "members.view", "members.manage"]);
const ADMIN = membership("administrator", ["organisation.view", "members.view", "members.manage"]);

/** Routes API calls by path, so tests don't depend on the order components fetch in. */
function mockApi(routes: Record<string, () => Response>) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace("http://api/api/v1", "");
    const key = `${init?.method ?? "GET"} ${path}`;
    const handler = routes[key] ?? routes[path];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const authenticated = {
  "/auth/me": () => jsonResponse(200, { user: USER, csrf_token: "csrf" }),
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  navigation.replace.mockReset();
  sessionChange.changeSession.mockReset();
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AppShell", () => {
  function shellRoutes(permissions: string[], organisations = [ORG]) {
    return {
      ...authenticated,
      "/organisation": () =>
        jsonResponse(200, { organisation: ORG, role: "driver", permissions }),
      "/organisations": () =>
        jsonResponse(
          200,
          organisations.map((organisation) => ({
            organisation,
            role: "driver",
            is_active: organisation.id === ORG.id,
          })),
        ),
    };
  }

  it("only links to pages the member's role can use", async () => {
    mockApi(shellRoutes(["organisation.view"]));
    renderWithQuery(<AppShell>content</AppShell>);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(await within(nav).findByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).queryByRole("link", { name: "Members" })).not.toBeInTheDocument();
  });

  it("shows Members to a role with permission", async () => {
    mockApi(shellRoutes(["members.view"]));
    renderWithQuery(<AppShell>content</AppShell>);
    expect(await screen.findByRole("link", { name: "Members" })).toBeInTheDocument();
  });

  it("offers only account pages before an organisation exists", async () => {
    mockApi({
      ...authenticated,
      "/organisation": () => errorResponse(403, "no_active_organisation"),
      "/organisations": () => jsonResponse(200, []),
    });
    renderWithQuery(<AppShell>content</AppShell>);
    expect(await screen.findByRole("link", { name: "Set up an organisation" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Account security" })).toBeInTheDocument();
  });

  it("switching organisation reloads the whole app", async () => {
    const other = { ...ORG, id: "org-2", name: "Metro Buses" };
    const mock = mockApi({
      ...shellRoutes(["organisation.view"], [ORG, other]),
      "POST /organisations/org-2/switch": () => jsonResponse(200, other),
    });
    const user = userEvent.setup();
    renderWithQuery(<AppShell>content</AppShell>);
    const switcher = await screen.findByLabelText("Organisation");
    await waitFor(() => expect(switcher).toHaveValue("org-1"));
    await user.selectOptions(switcher, "org-2");
    await waitFor(() => expect(sessionChange.changeSession).toHaveBeenCalledWith("/dashboard"));
    expect(mock.mock.calls.some(([url]) => String(url).includes("/org-2/switch"))).toBe(true);
  });
});

describe("RequireOrganisation", () => {
  it("sends someone with no organisation to set one up", async () => {
    mockApi({ "/organisation": () => errorResponse(403, "no_active_organisation") });
    renderWithQuery(<RequireOrganisation>{() => "content"}</RequireOrganisation>);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/onboarding"));
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("explains when a role doesn't include the page", async () => {
    mockApi({
      "/organisation": () => jsonResponse(200, membership("driver", ["organisation.view"])),
    });
    renderWithQuery(
      <RequireOrganisation permission="members.view">{() => "content"}</RequireOrganisation>,
    );
    expect(await screen.findByText(/doesn't include this page/)).toBeInTheDocument();
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("shows an error with a retry", async () => {
    mockApi({ "/organisation": () => errorResponse(500, "server_error", "Something failed.") });
    renderWithQuery(<RequireOrganisation>{() => "content"}</RequireOrganisation>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something failed.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("DashboardView", () => {
  const ZERO = {
    vehicles: {
      total: 0,
      active: 0,
      idle: 0,
      maintenance: 0,
      out_of_service: 0,
      utilisation_percent: null,
    },
    drivers: {
      total: 0,
      available: 0,
      on_trip: 0,
      off_duty: 0,
      unavailable: 0,
      licences_expiring_soon: 0,
      licences_expired: 0,
    },
    trips: { in_progress: 0, scheduled: 0 },
  };

  it("shows an honest empty state, not a wall of zeros", async () => {
    mockApi({ "/dashboard": () => jsonResponse(200, ZERO) });
    renderWithQuery(<DashboardView organisationName="Swift" />);
    expect(await screen.findByText("Nothing to report yet")).toBeInTheDocument();
    expect(screen.queryByText("Fleet utilisation")).not.toBeInTheDocument();
  });

  it("shows real figures, with counts as text", async () => {
    mockApi({
      "/dashboard": () =>
        jsonResponse(200, {
          ...ZERO,
          vehicles: {
            total: 4,
            active: 2,
            idle: 1,
            maintenance: 1,
            out_of_service: 0,
            utilisation_percent: 50,
          },
          drivers: { ...ZERO.drivers, total: 3, available: 2, licences_expired: 1 },
          trips: { in_progress: 1, scheduled: 5 },
        }),
    });
    renderWithQuery(<DashboardView organisationName="Swift" />);
    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Vehicles by status")).toBeInTheDocument();
    const active = screen.getByText("Active").closest("li") as HTMLElement;
    expect(active).toHaveTextContent("2");
    expect(screen.getByText("5 scheduled")).toBeInTheDocument();
    expect(screen.getByText(/1 driver licence has expired/)).toBeInTheDocument();
  });

  it("leaves out what the role can't see, instead of showing zero", async () => {
    mockApi({
      "/dashboard": () =>
        jsonResponse(200, { vehicles: null, drivers: null, trips: { in_progress: 2, scheduled: 0 } }),
    });
    renderWithQuery(<DashboardView organisationName="Swift" />);
    expect(await screen.findByText("Trips in progress")).toBeInTheDocument();
    expect(screen.queryByText("Total vehicles")).not.toBeInTheDocument();
  });

  it("shows an error with a retry", async () => {
    mockApi({ "/dashboard": () => errorResponse(500, "server_error", "Something failed.") });
    renderWithQuery(<DashboardView organisationName="Swift" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something failed.");
  });
});

describe("MembersTable", () => {
  const MEMBERS: Member[] = [
    { id: "m1", user_id: "me", email: USER.email, full_name: USER.full_name, role: "owner", status: "active" },
    { id: "m2", user_id: "u2", email: "tunde@example.com", full_name: "Tunde", role: "driver", status: "active" },
    { id: "m3", user_id: "u3", email: "sam@example.com", full_name: "Sam", role: "owner", status: "suspended" },
  ];
  const routes = {
    ...authenticated,
    "/organisation/members": () => jsonResponse(200, MEMBERS),
    "/organisation": () => jsonResponse(200, OWNER),
    "/organisations": () => jsonResponse(200, []),
  };

  it("marks you, and doesn't offer to suspend or remove you", async () => {
    mockApi(routes);
    renderWithQuery(<MembersTable membership={OWNER} />);
    expect(await screen.findByText("(you)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Suspend ${USER.full_name}` })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suspend Tunde" })).toBeInTheDocument();
  });

  it("changing to an ordinary role saves straight away", async () => {
    const mock = mockApi({
      ...routes,
      "PATCH /organisation/members/m2": () => jsonResponse(200, MEMBERS[1]),
    });
    const user = userEvent.setup();
    renderWithQuery(<MembersTable membership={OWNER} />);
    await user.selectOptions(await screen.findByLabelText("Role for Tunde"), "dispatcher");
    await waitFor(() =>
      expect(mock.mock.calls.some(([url]) => String(url).endsWith("/members/m2"))).toBe(true),
    );
  });

  it("making someone an owner needs confirmation", async () => {
    const mock = mockApi({
      ...routes,
      "PATCH /organisation/members/m2": () => jsonResponse(200, MEMBERS[1]),
    });
    const user = userEvent.setup();
    renderWithQuery(<MembersTable membership={OWNER} />);
    await user.selectOptions(await screen.findByLabelText("Role for Tunde"), "owner");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Make Tunde an owner?");
    expect(mock.mock.calls.some(([url]) => String(url).endsWith("/members/m2"))).toBe(false);
  });

  it("removing someone needs confirmation", async () => {
    const mock = mockApi({
      ...routes,
      "DELETE /organisation/members/m2": () => jsonResponse(204),
    });
    const user = userEvent.setup();
    renderWithQuery(<MembersTable membership={OWNER} />);
    await user.click(await screen.findByRole("button", { name: "Remove Tunde" }));
    expect(mock.mock.calls.some(([url]) => String(url).endsWith("/members/m2"))).toBe(false);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(mock.mock.calls.some(([url]) => String(url).endsWith("/members/m2"))).toBe(true),
    );
  });

  it("an administrator can't edit owners or grant ownership", async () => {
    mockApi(routes);
    renderWithQuery(<MembersTable membership={ADMIN} />);
    await screen.findByText("Tunde");
    expect(screen.queryByLabelText("Role for Sam")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Sam" })).not.toBeInTheDocument();
    const select = screen.getByLabelText("Role for Tunde");
    expect(within(select).queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
  });

  it("someone who can only view gets no controls", async () => {
    mockApi(routes);
    renderWithQuery(
      <MembersTable membership={membership("fleet_manager", ["members.view"])} />,
    );
    await screen.findByText("Tunde");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove|Suspend/ })).not.toBeInTheDocument();
  });

  it("offers reactivation for a suspended member", async () => {
    mockApi(routes);
    renderWithQuery(<MembersTable membership={OWNER} />);
    expect(await screen.findByRole("button", { name: "Reactivate Sam" })).toBeInTheDocument();
    expect(screen.getByText("Suspended")).toBeInTheDocument();
  });
});

describe("Invitations", () => {
  it("doesn't offer Owner to an administrator", async () => {
    mockApi({ "/organisation/invitations": () => jsonResponse(200, []) });
    renderWithQuery(<Invitations membership={ADMIN} />);
    expect(await screen.findByText(/No invitations are waiting/)).toBeInTheDocument();
    const select = screen.getByLabelText("Role");
    expect(within(select).queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
  });

  it("puts an already-a-member error on the email field", async () => {
    mockApi({
      ...authenticated,
      "/organisation/invitations": () => jsonResponse(200, []),
      "POST /organisation/invitations": () =>
        errorResponse(409, "already_member", "This person is already a member."),
    });
    const user = userEvent.setup();
    renderWithQuery(<Invitations membership={OWNER} />);
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText("This person is already a member.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });
});
