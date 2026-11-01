import { afterEach, describe, expect, it, vi } from "vitest";

import { changeSession, subscribeToSessionChanges } from "./session-change";

describe("session change messages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("doesn't react to this tab's own announcement, which would cancel its navigation", async () => {
    vi.stubGlobal("location", { assign: vi.fn() });
    const onChange = vi.fn();
    const unsubscribe = subscribeToSessionChanges(onChange);
    changeSession("/login");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onChange).not.toHaveBeenCalled();
    expect(window.location.assign).toHaveBeenCalledWith("/login");
    unsubscribe();
  });
});
