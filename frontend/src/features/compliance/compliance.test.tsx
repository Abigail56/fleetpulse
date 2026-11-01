import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import type { CurrentMembership } from "@/features/organisation/api";
import { clearAuthState } from "@/lib/api/client";

import type { ComplianceDocument, Defect, Template } from "./api";
import { ComplianceOverview } from "./compliance-overview";
import { NewDocument, NewTemplate } from "./compliance-forms";
import { NewInspection } from "./inspection-pages";

vi.mock("next/navigation", () => ({
  usePathname: () => "/compliance",
  useParams: () => ({ id: "x1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const organisation = { distance_unit: "km" };
const member = (permissions: string[]) => ({ organisation, permissions }) as unknown as CurrentMembership;
const MANAGER = member(["compliance.view", "compliance.manage", "inspections.submit", "maintenance.manage"]);
const VIEWER = member(["compliance.view"]);
const DRIVER = member(["inspections.submit"]);

const DOCUMENT: ComplianceDocument = {
  id: "d1",
  vehicle_id: "v1",
  vehicle_registration: "KCA 123A",
  driver_id: null,
  driver_name: null,
  document_type: "insurance",
  title: "Motor insurance",
  reference_number: "POL-1",
  issued_on: null,
  expires_on: "2020-01-05",
  state: "expired",
  file: null,
  notes: null,
  archived_at: null,
};
const DEFECT: Defect = {
  id: "f1",
  vehicle_id: "v1",
  vehicle_registration: "KCA 123A",
  inspection_id: null,
  title: "Brakes",
  description: null,
  severity: "critical",
  status: "open",
  photo: null,
  work_order_id: null,
  resolved_at: null,
  resolution_note: null,
  created_at: "2030-01-01T00:00:00Z",
};
const TEMPLATE: Template = {
  id: "t1",
  name: "Pre-trip",
  archived_at: null,
  items: [
    { id: "i1", label: "Brakes", critical: true },
    { id: "i2", label: "Wipers", critical: false },
  ],
};
const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 25 });
const ROUTES = {
  "/compliance/summary": () =>
    jsonResponse(200, {
      expired_documents: 1,
      expiring_documents: 0,
      open_defects: 1,
      critical_defects: 1,
      failed_inspections_30_days: 0,
    }),
  "/compliance/documents": () => jsonResponse(200, [DOCUMENT]),
  "/compliance/my-documents": () => jsonResponse(200, []),
  "/compliance/defects": () => jsonResponse(200, page([DEFECT])),
  "/compliance/inspections": () => jsonResponse(200, page([])),
  "/compliance/templates": () => jsonResponse(200, [TEMPLATE]),
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

describe("ComplianceOverview", () => {
  it("shows what needs attention and what a critical defect means", async () => {
    mockApi(ROUTES);
    renderWithQuery(<ComplianceOverview membership={MANAGER} />);
    expect(await screen.findByText("Expired")).toBeVisible();
    expect(await screen.findByText(/can.t be dispatched until this is fixed/)).toBeVisible();
    expect(await screen.findByRole("button", { name: "Create work order" })).toBeVisible();
  });

  it("doesn't call a document with no expiry valid", async () => {
    mockApi({
      ...ROUTES,
      "/compliance/documents": () =>
        jsonResponse(200, [{ ...DOCUMENT, state: "no_expiry", expires_on: null }]),
    });
    renderWithQuery(<ComplianceOverview membership={MANAGER} />);
    const list = await screen.findByRole("list", { name: "Documents" });
    expect(list).toHaveTextContent("No expiry date");
    expect(list).not.toHaveTextContent("Valid");
  });

  it("gives viewers nothing to change", async () => {
    mockApi(ROUTES);
    renderWithQuery(<ComplianceOverview membership={VIEWER} />);
    await screen.findByText("Motor insurance", { exact: false });
    expect(screen.queryByRole("link", { name: /Add document/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
    expect(screen.queryByRole("link", { name: /New inspection/ })).toBeNull();
  });

  it("gives a driver inspections and their own documents, without company totals", async () => {
    const mock = mockApi({
      ...ROUTES,
      "/compliance/my-documents": () =>
        jsonResponse(200, [{ ...DOCUMENT, id: "m1", title: "My licence", vehicle_id: null, driver_name: "Tunde" }]),
    });
    renderWithQuery(<ComplianceOverview membership={DRIVER} />);
    expect(await screen.findByRole("list", { name: "My documents" })).toBeVisible();
    expect(screen.getByRole("link", { name: /New inspection/ })).toBeVisible();
    expect(screen.queryByText("Documents expired")).toBeNull();
    expect(mock.mock.calls.some(([url]) => String(url).includes("/compliance/summary"))).toBe(false);
    expect(mock.mock.calls.some(([url]) => String(url).includes("/compliance/documents"))).toBe(false);
  });

  it("shows errors rather than empty states", async () => {
    mockApi({
      ...ROUTES,
      "/compliance/documents": () => errorResponse(500, "server_error", "Documents failed."),
    });
    renderWithQuery(<ComplianceOverview membership={MANAGER} />);
    expect(await screen.findByText("Documents failed.")).toBeVisible();
    expect(screen.queryByText("No documents yet")).toBeNull();
  });
});

describe("NewInspection", () => {
  const ROUTES_FORM = {
    "/compliance/options": () =>
      jsonResponse(200, {
        vehicles: [{ id: "v1", registration_number: "KCA 123A", make: "Isuzu", model: "NPR" }],
        drivers: [],
      }),
    "/compliance/templates": () => jsonResponse(200, [TEMPLATE]),
  };

  it("refuses to save with unanswered checks, because none default to a pass", async () => {
    const mock = mockApi(ROUTES_FORM);
    renderWithQuery(<NewInspection membership={DRIVER} />);
    await screen.findByRole("option", { name: "Pre-trip" });
    await userEvent.selectOptions(screen.getByLabelText("Template"), "t1");
    await screen.findAllByRole("radio");
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Save inspection" }));
    expect(screen.getByRole("alert")).toHaveTextContent("2 still to do");
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("warns when a critical check fails, and sends every answer", async () => {
    const mock = mockApi({
      ...ROUTES_FORM,
      "POST /compliance/inspections": () => jsonResponse(201, { id: "n1" }),
    });
    renderWithQuery(<NewInspection membership={DRIVER} />);
    await screen.findByRole("option", { name: "Pre-trip" });
    await userEvent.selectOptions(screen.getByLabelText("Template"), "t1");
    const [brakesFail, wipersPass] = [
      screen.getAllByRole("radio", { name: "Fail" })[0],
      screen.getAllByRole("radio", { name: "Pass" })[1],
    ];
    await userEvent.click(brakesFail);
    expect(screen.getByText(/A critical check failed/)).toBeVisible();
    await userEvent.click(wipersPass);
    await userEvent.click(screen.getByRole("button", { name: "Save inspection" }));
    await waitFor(() => {
      const call = mock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(call?.[1]?.body)).answers).toEqual([
        { item_id: "i1", result: "fail" },
        { item_id: "i2", result: "pass" },
      ]);
    });
  });

  it("explains what's missing when there are no templates or vehicles", async () => {
    mockApi({
      "/compliance/options": () => jsonResponse(200, { vehicles: [], drivers: [] }),
      "/compliance/templates": () => jsonResponse(200, []),
    });
    renderWithQuery(<NewInspection membership={DRIVER} />);
    expect(await screen.findByText(/No vehicle is available/)).toBeVisible();
    expect(await screen.findByText(/No inspection templates exist/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Create one first" })).toBeNull();
  });
});

describe("forms", () => {
  it("requires an owner for a document, and an expiry after issue", async () => {
    const mock = mockApi({
      "/compliance/options": () => jsonResponse(200, { vehicles: [], drivers: [] }),
    });
    renderWithQuery(<NewDocument />);
    await userEvent.type(screen.getByLabelText(/^Title/), "Policy");
    await userEvent.type(screen.getByLabelText(/^Issued on/), "2030-05-01");
    await userEvent.type(screen.getByLabelText(/^Expires on/), "2030-01-01");
    await userEvent.click(screen.getByRole("button", { name: "Add document" }));
    expect(await screen.findByText("Please choose a vehicle or driver.")).toBeVisible();
    expect(screen.getByText("The expiry date must be after the issue date.")).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("builds a template, with critical checks marked", async () => {
    const mock = mockApi({ "POST /compliance/templates": () => jsonResponse(201, TEMPLATE) });
    renderWithQuery(<NewTemplate />);
    await userEvent.type(screen.getByLabelText(/^Name/), "Pre-trip");
    await userEvent.type(screen.getByLabelText(/^Check 1/), "Brakes");
    await userEvent.click(screen.getByLabelText("Critical"));
    await userEvent.click(screen.getByRole("button", { name: "Add a check" }));
    await userEvent.type(screen.getByLabelText(/^Check 2/), "Wipers");
    await userEvent.click(screen.getByRole("button", { name: "Create template" }));
    await waitFor(() => {
      const call = mock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        name: "Pre-trip",
        items: [
          { label: "Brakes", critical: true },
          { label: "Wipers", critical: false },
        ],
      });
    });
  });
});
