import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import GeoapifyLiveMapCanvas from "./geoapify-live-map-canvas";

describe("GeoapifyLiveMapCanvas", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("shows vehicle positions when WebGL is unavailable and Geoapify has no key", async () => {
    vi.stubEnv("NEXT_PUBLIC_GEOAPIFY_API_KEY", "");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <GeoapifyLiveMapCanvas
        vehicles={[]}
        selected={null}
        route={[]}
        focusRequest={0}
        fitRequest={0}
        onSelect={() => {}}
      />,
    );

    expect(await screen.findByRole("img", { name: /simplified live view of vehicle positions/i })).toBeInTheDocument();
    expect(screen.getByText(/webgl isn't available/i)).toBeInTheDocument();
  });
});
