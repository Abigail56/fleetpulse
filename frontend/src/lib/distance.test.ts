import { describe, expect, it } from "vitest";

import { formatDistance, fromKm, toKm } from "./distance";

describe("distance", () => {
  it("leaves kilometres alone", () => {
    expect(toKm(100.5, "km")).toBe(100.5);
    expect(fromKm(100.5, "km")).toBe(100.5);
  });

  it("converts miles to stored kilometres and back without drifting", () => {
    expect(toKm(100, "mi")).toBe(160.9);
    expect(fromKm(toKm(100, "mi"), "mi")).toBe(100);
  });

  it("formats with the unit", () => {
    expect(formatDistance(12345.6, "km")).toBe("12,345.6 km");
    expect(formatDistance(160.9, "mi")).toBe("100 mi");
  });
});
