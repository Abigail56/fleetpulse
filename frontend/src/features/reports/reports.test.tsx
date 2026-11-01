import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorResponse, jsonResponse, renderWithQuery } from "@/features/auth/test-utils";
import { clearAuthState } from "@/lib/api/client";

import type { ReportColumn, ReportData } from "./api";
import { formatCell, Reports } from "./reports";

vi.mock("next/navigation", () => ({
  usePathname: () => "/reports",
  useSearchParams: () => new URLSearchParams(),
}));

const CATALOGUE = [
  { key: "utilisation", title: "Vehicle utilisation", description: "How much each vehicle was used." },
  { key: "fleet", title: "Fleet performance", description: "Cost by vehicle." },
];
const REPORT: ReportData = {
  key: "utilisation",
  title: "Vehicle utilisation",
  start: "2030-01-01",
  end: "2030-01-30",
  tiles: [{ label: "Vehicles used", value: "1 of 2" }],
  columns: [
    { key: "vehicle", label: "Vehicle", kind: "text" },
    { key: "distance", label: "Trip distance", kind: "distance" },
    { key: "rate", label: "Rate", kind: "percent" },
  ],
  rows: [{ vehicle: "KCA 123A", distance: "160.9", rate: null }],
  notes: ["Based on completed trips."],
  truncated: false,
};

function mockApi(routes: Record<string, () => Response>) {
  const mock = vi.fn(async (url: string) => {
    const path = String(url).replace("http://api/api/v1", "").split("?")[0];
    if (path === "/auth/me") return jsonResponse(200, { user: {}, csrf_token: "c" });
    const handler = routes[path];
    if (!handler) throw new Error(`Unexpected request: ${path}`);
    return handler();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const ROUTES = {
  "/reports": () => jsonResponse(200, CATALOGUE),
  "/reports/utilisation": () => jsonResponse(200, REPORT),
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("formatCell", () => {
  const column = (kind: ReportColumn["kind"]): ReportColumn => ({ key: "x", label: "X", kind });

  it("shows a missing value as a dash, and a real zero as zero", () => {
    expect(formatCell(null, column("money"), "km")).toBe("–");
    expect(formatCell(undefined, column("percent"), "km")).toBe("–");
    expect(formatCell("0", column("number"), "km")).toBe("0");
    expect(formatCell("0", column("percent"), "km")).toBe("0%");
  });

  it("converts distance to the organisation's unit", () => {
    expect(formatCell("160.9", column("distance"), "km")).toBe("160.9 km");
    expect(formatCell("160.9", column("distance"), "mi")).toBe("100 mi");
  });

  it("never treats a typed value as markup or a number", () => {
    expect(formatCell("<b>x</b>", column("text"), "km")).toBe("<b>x</b>");
  });
});

describe("Reports", () => {
  it("shows the figures, the period and what they mean", async () => {
    mockApi(ROUTES);
    renderWithQuery(<Reports unit="km" />);
    expect(await screen.findByText("1 of 2")).toBeVisible();
    expect(screen.getByRole("cell", { name: "160.9 km" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "–" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Trip distance (km)" })).toBeVisible();
    expect(screen.getByRole("list", { name: "About these figures" })).toHaveTextContent("Based on completed trips");
    expect(screen.getByRole("region", { name: "Vehicle utilisation table" })).toHaveAttribute("tabindex", "0");
  });

  it("explains an empty report instead of showing an empty table", async () => {
    mockApi({ ...ROUTES, "/reports/utilisation": () => jsonResponse(200, { ...REPORT, rows: [] }) });
    renderWithQuery(<Reports unit="km" />);
    expect(await screen.findByText("Nothing to report in this period")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says so when rows were cut off", async () => {
    mockApi({ ...ROUTES, "/reports/utilisation": () => jsonResponse(200, { ...REPORT, truncated: true }) });
    renderWithQuery(<Reports unit="km" />);
    expect(await screen.findByText(/Only the first 1 rows/)).toBeVisible();
  });

  it("shows an error with a retry, and offers no export", async () => {
    mockApi({
      ...ROUTES,
      "/reports/utilisation": () => errorResponse(500, "server_error", "It failed."),
    });
    renderWithQuery(<Reports unit="km" />);
    expect(await screen.findByText("It failed.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.getByRole("button", { name: "CSV" })).toBeDisabled();
  });

  it("refuses dates the wrong way round", async () => {
    mockApi(ROUTES);
    renderWithQuery(<Reports unit="km" />);
    await screen.findByText("1 of 2");
    await userEvent.type(screen.getByLabelText("From"), "2030-05-01");
    await userEvent.type(screen.getByLabelText("To"), "2030-01-01");
    expect(await screen.findByText("Choose a start date before the end date.")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled());
  });
});
