import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DEMO_FLEET, formatAge } from "./demo-fleet";
import { LiveFleetPanel } from "./live-fleet";
import { RouteFallback } from "./route-fallback";
import {
  distanceMetres,
  headingDegrees,
  pointAlongRoute,
  routeLengthMetres,
} from "./route-geometry";
import { advance, createSimulatedFeed, initialState, type SimulatedVehicle } from "./simulated-feed";
import type { LatLng } from "./types";

// The real map needs a browser's layout, and is covered by the browser tests.
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="map" /> }));

const ROUTE: LatLng[] = [
  [0, 0],
  [0, 0.01],
  [0.01, 0.01],
];
const MOVING: SimulatedVehicle = {
  id: "A",
  description: "Van",
  status: "moving",
  route: ROUTE,
  startFraction: 0,
  cruiseKph: 50,
  secondsSinceUpdate: 0,
  locationName: "Here",
  destination: "There",
};

describe("route geometry", () => {
  it("measures distance", () => {
    expect(distanceMetres([0, 0], [0, 1])).toBeCloseTo(111195, -2);
    expect(routeLengthMetres(ROUTE)).toBeCloseTo(2224, -1);
  });

  it("gives compass headings", () => {
    expect(headingDegrees([0, 0], [0, 1])).toBeCloseTo(90);
    expect(headingDegrees([0, 0], [1, 0])).toBeCloseTo(0);
  });

  it("interpolates between points, staying on the route", () => {
    const halfway = pointAlongRoute(ROUTE, routeLengthMetres(ROUTE) * 0.25).position;
    expect(halfway[0]).toBeCloseTo(0);
    expect(halfway[1]).toBeCloseTo(0.005);
  });

  it("clamps to the ends of the route", () => {
    expect(pointAlongRoute(ROUTE, -5).position).toEqual([0, 0]);
    expect(pointAlongRoute(ROUTE, 1e9).position).toEqual([0.01, 0.01]);
  });
});

describe("simulated feed", () => {
  it("moves a moving vehicle in small steps, never jumping", () => {
    let state = initialState(MOVING);
    for (let index = 0; index < 50; index += 1) {
      const next = advance(state, 0.1);
      expect(Math.abs(next.metres - state.metres)).toBeLessThan(10);
      state = next;
    }
    expect(state.metres).toBeGreaterThan(0);
  });

  it("turns around at the end of a route rather than teleporting", () => {
    let state = initialState({ ...MOVING, startFraction: 0.999 });
    const length = state.lengthMetres;
    for (let index = 0; index < 100; index += 1) {
      state = advance(state, 0.1);
      expect(state.metres).toBeLessThanOrEqual(length);
    }
    expect(state.direction).toBe(-1);
  });

  it("leaves stopped vehicles in place, with their data ageing", () => {
    for (const status of ["idle", "stale", "offline"] as const) {
      const start = initialState({ ...MOVING, status, startFraction: 0.5, secondsSinceUpdate: 10 });
      const later = advance(start, 5);
      expect(later.metres).toBe(start.metres);
      expect(later.secondsSinceUpdate).toBe(15);
    }
  });

  it("reports stale and offline speed as unknown, and idle as zero", () => {
    const feed = createSimulatedFeed([
      { ...MOVING, id: "S", status: "stale" },
      { ...MOVING, id: "O", status: "offline" },
      { ...MOVING, id: "I", status: "idle" },
    ]);
    expect(feed.getSnapshot().map((vehicle) => vehicle.speedKph)).toEqual([null, null, 0]);
  });

  it("stops its timer when told to, and notifies listeners until unsubscribed", () => {
    vi.useFakeTimers();
    const feed = createSimulatedFeed([MOVING]);
    const listener = vi.fn();
    const unsubscribe = feed.subscribe(listener);
    const stop = feed.start();
    vi.advanceTimersByTime(250);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    const calls = listener.mock.calls.length;
    vi.advanceTimersByTime(250);
    expect(listener).toHaveBeenCalledTimes(calls);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("keeps vehicles still when animation is off", () => {
    vi.useFakeTimers();
    const feed = createSimulatedFeed([MOVING], { animate: false });
    const before = feed.getSnapshot()[0].position;
    const stop = feed.start();
    vi.advanceTimersByTime(2000);
    expect(feed.getSnapshot()[0].position).toEqual(before);
    stop();
    vi.useRealTimers();
  });
});

describe("demo fleet", () => {
  it("has each status, on routes with real geometry", () => {
    expect(new Set(DEMO_FLEET.map((vehicle) => vehicle.status))).toEqual(
      new Set(["moving", "idle", "stale", "offline"]),
    );
    for (const vehicle of DEMO_FLEET) expect(vehicle.route.length).toBeGreaterThan(5);
  });

  it.each([
    [20, "20 sec ago"],
    [180, "3 min ago"],
    [2520, "42 min ago"],
    [19800, "5 hr ago"],
  ])("formats %i seconds", (seconds, text) => {
    expect(formatAge(seconds)).toBe(text);
  });
});

describe("LiveFleetPanel", () => {
  function panel() {
    return render(<LiveFleetPanel feed={createSimulatedFeed(DEMO_FLEET, { animate: false })} />);
  }

  it("labels the data as simulated, and summarises the fleet", () => {
    panel();
    expect(screen.getByText("DEMO · SIMULATED VEHICLE DATA")).toBeInTheDocument();
    expect(screen.getByText("5 vehicles · 2 moving")).toBeInTheDocument();
  });

  it("shows status as text, never colour alone, and doesn't invent speeds", () => {
    panel();
    const stale = screen.getByRole("button", { name: /FP-3306/ });
    expect(within(stale).getByText("Stale GPS")).toBeInTheDocument();
    expect(within(stale).getByText("Speed unknown")).toBeInTheDocument();
    expect(within(stale).getByText("42 min ago")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /FP-2178/ })).getByText("0 km/h")).toBeInTheDocument();
  });

  it("selecting a vehicle shows its details", async () => {
    const user = userEvent.setup();
    panel();
    const row = screen.getByRole("button", { name: /FP-4417/ });
    expect(row).toHaveAttribute("aria-pressed", "false");
    await user.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(within(row).getByText(/Heading to Victoria Island/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /FP-1042/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("cleans up its timers when removed", async () => {
    vi.useFakeTimers();
    const { unmount } = panel();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    await waitFor(() => expect(true).toBe(true));
  });
});

describe("RouteFallback", () => {
  it("draws every route without the map library, and says it's simplified", () => {
    const feed = createSimulatedFeed(DEMO_FLEET);
    const { container } = render(<RouteFallback vehicles={feed.getSnapshot()} selectedId="FP-1042" />);
    expect(container.querySelectorAll("polyline")).toHaveLength(DEMO_FLEET.length);
    expect(screen.getByText(/couldn't load/)).toBeInTheDocument();
  });
});
