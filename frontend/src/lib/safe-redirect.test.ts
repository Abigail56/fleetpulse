import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it.each(["/account", "/accept-invitation?token=abc", "/a/b#c"])("allows %s", (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it.each([
    null,
    "",
    "https://evil.example.com",
    "//evil.example.com",
    "/\\evil.example.com",
    "\\\\evil.example.com",
    "javascript:alert(1)",
    "/\tevil",
    "/\nevil",
    "evil",
  ])("rejects %s", (path) => {
    expect(safeRedirectPath(path)).toBe("/dashboard");
  });
});
