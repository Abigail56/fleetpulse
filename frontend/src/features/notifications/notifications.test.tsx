import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import type { Rule } from "@/features/automation/api";
import { AutomationOverview, describeAction } from "@/features/automation/automation-overview";
import { NewRule } from "@/features/automation/rule-form";
import { clearAuthState } from "@/lib/api/client";

import type { NotificationItem } from "./api";
import { NotificationCentre } from "./notification-centre";

vi.mock("next/navigation", () => ({
  usePathname: () => "/notifications",
  useParams: () => ({ id: "r1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const NOTE: NotificationItem = {
  id: "n1",
  alert_id: "a1",
  title: "KCA 123A: Brakes",
  body: "A critical defect was reported.",
  severity: "critical",
  read_at: null,
  email_status: "failed",
  created_at: "2030-01-01T08:00:00Z",
};
const PREFS = [
  { alert_type: "speeding", in_app: true, email_mode: "critical" },
  { alert_type: "defect_reported", in_app: true, email_mode: "critical" },
];
const RULE: Rule = {
  id: "r1",
  name: "Tell managers",
  is_enabled: true,
  alert_types: ["document_expiry"],
  min_severity: "warning",
  vehicle_id: null,
  actions: [{ type: "notify", roles: ["fleet_manager"], email: true }],
  archived_at: null,
  created_at: "2030-01-01T00:00:00Z",
};
const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 25 });
const ROUTES = {
  "/notifications": () => jsonResponse(200, page([NOTE])),
  "/notifications/preferences": () => jsonResponse(200, PREFS),
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

const bodyOf = (mock: ReturnType<typeof mockApi>, method: string) => {
  const call = mock.mock.calls.find(([, init]) => init?.method === method);
  return JSON.parse(String(call?.[1]?.body));
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("NotificationCentre", () => {
  it("is honest when an email couldn't be sent", async () => {
    mockApi(ROUTES);
    renderWithQuery(<NotificationCentre />);
    const list = await screen.findByRole("list", { name: "Notifications" });
    expect(within(list).getByText("Email couldn't be sent")).toBeVisible();
    expect(within(list).getByText(/Unread:/)).toBeInTheDocument();
  });

  it("marks a notification as read", async () => {
    const mock = mockApi({ ...ROUTES, "POST /notifications/n1/read": () => jsonResponse(200, NOTE) });
    renderWithQuery(<NotificationCentre />);
    await userEvent.click(await screen.findByRole("button", { name: /Mark as read: KCA 123A/ }));
    await waitFor(() =>
      expect(mock.mock.calls.some(([url]) => String(url).endsWith("/n1/read"))).toBe(true),
    );
  });

  it("offers nothing to mark on a read one", async () => {
    mockApi({
      ...ROUTES,
      "/notifications": () => jsonResponse(200, page([{ ...NOTE, read_at: "2030-01-01T09:00:00Z" }])),
    });
    renderWithQuery(<NotificationCentre />);
    await screen.findByRole("list", { name: "Notifications" });
    expect(screen.queryByRole("button", { name: /Mark as read:/ })).toBeNull();
  });

  it("explains an empty list, and doesn't when loading failed", async () => {
    mockApi({ ...ROUTES, "/notifications": () => jsonResponse(200, page([])) });
    const { unmount } = renderWithQuery(<NotificationCentre />);
    expect(await screen.findByText("No notifications yet")).toBeVisible();
    unmount();
    mockApi({ ...ROUTES, "/notifications": () => errorResponse(500, "server_error", "It failed.") });
    renderWithQuery(<NotificationCentre />);
    expect(await screen.findByText("It failed.")).toBeVisible();
    expect(screen.queryByText("No notifications yet")).toBeNull();
  });

  it("saves changed preferences, with nothing to save until something changes", async () => {
    const mock = mockApi({
      ...ROUTES,
      "PATCH /notifications/preferences": () => jsonResponse(200, PREFS),
    });
    renderWithQuery(<NotificationCentre />);
    const select = await screen.findByLabelText("Speeding: email");
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeDisabled();
    await userEvent.selectOptions(select, "off");
    await userEvent.click(screen.getByLabelText("Speeding: show in FleetPulse"));
    await userEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => {
      expect(bodyOf(mock, "PATCH").preferences[0]).toEqual({
        alert_type: "speeding",
        in_app: false,
        email_mode: "off",
      });
    });
  });
});

describe("rules", () => {
  it("describes actions in plain words", () => {
    expect(describeAction({ type: "notify", roles: ["fleet_manager"], email: true })).toBe(
      "Notify Fleet managers by email too",
    );
    expect(describeAction({ type: "create_work_order", title: null })).toBe("Create a work order");
  });

  it("requires a name, a trigger and an action, without calling the API", async () => {
    const mock = mockApi({});
    renderWithQuery(<NewRule />);
    const save = screen.getByRole("button", { name: "Create rule" });
    await userEvent.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent("give the rule a name");
    await userEvent.type(screen.getByLabelText("Name"), "Rule");
    await userEvent.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent("at least one type of alert");
    await userEvent.click(screen.getByLabelText("Speeding"));
    await userEvent.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent("at least one thing to do");
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("won't create a work order from a licence alert", async () => {
    mockApi({});
    renderWithQuery(<NewRule />);
    await userEvent.type(screen.getByLabelText("Name"), "Rule");
    await userEvent.click(screen.getByLabelText("Licence expiry"));
    await userEvent.click(screen.getByLabelText("Create a work order for the vehicle"));
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/about a vehicle/);
  });

  it("offers no driver role, which can't view alerts", () => {
    mockApi({});
    renderWithQuery(<NewRule />);
    expect(screen.queryByLabelText(/Drivers/)).toBeNull();
    expect(screen.getByLabelText("Fleet managers")).toBeVisible();
  });

  it("creates a rule", async () => {
    const mock = mockApi({ "POST /automation/rules": () => jsonResponse(201, RULE) });
    renderWithQuery(<NewRule />);
    await userEvent.type(screen.getByLabelText("Name"), "Insurance watch");
    await userEvent.click(screen.getByLabelText("Document expiry"));
    await userEvent.click(screen.getByLabelText("Fleet managers"));
    await userEvent.click(screen.getByLabelText(/Email them too/));
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));
    await waitFor(() => {
      expect(bodyOf(mock, "POST")).toEqual({
        name: "Insurance watch",
        alert_types: ["document_expiry"],
        min_severity: "info",
        actions: [{ type: "notify", roles: ["fleet_manager"], email: true }],
      });
    });
  });

  it("switches a rule off, and shows failures in the history", async () => {
    const mock = mockApi({
      "/automation/rules": () => jsonResponse(200, [RULE]),
      "/automation/runs": () =>
        jsonResponse(
          200,
          page([
            {
              id: "x",
              rule_id: "r1",
              rule_name: "Tell managers",
              alert_title: "Insurance",
              status: "failed",
              attempts: 3,
              outcome: "Failed after 3 attempts",
              created_at: "2030-01-01T00:00:00Z",
              finished_at: null,
            },
          ]),
        ),
      "PATCH /automation/rules/r1": () => jsonResponse(200, { ...RULE, is_enabled: false }),
    });
    renderWithQuery(<AutomationOverview />);
    expect(await screen.findByText(/Failed after 3 attempts/)).toBeVisible();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Tell managers: on" }));
    await waitFor(() => expect(bodyOf(mock, "PATCH")).toEqual({ is_enabled: false }));
  });
});
