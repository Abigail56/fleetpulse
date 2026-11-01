import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUrlFilters } from "./use-url-filters";

const navigation = vi.hoisted(() => ({ query: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/list",
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

const read = (params: URLSearchParams) => params.get("q") ?? "";

describe("useUrlFilters", () => {
  beforeEach(() => {
    navigation.query = "";
    window.history.replaceState(null, "", "/list");
  });

  it("reads from the URL", () => {
    navigation.query = "q=a";
    const { result } = renderHook(() => useUrlFilters(read));
    expect(result.current[0]).toBe("a");
  });

  it("shows a new value immediately, before the URL has caught up", () => {
    const { result } = renderHook(() => useUrlFilters(read));
    act(() => result.current[1]("b", "q=b"));
    expect(result.current[0]).toBe("b");
    expect(window.location.search).toBe("?q=b");
  });

  it("follows the URL again once it has caught up, including a later link", () => {
    const { result, rerender } = renderHook(() => useUrlFilters(read));
    act(() => result.current[1]("b", "q=b"));
    navigation.query = "q=b";
    rerender();
    navigation.query = "q=from-a-link";
    rerender();
    expect(result.current[0]).toBe("from-a-link");
  });
});
