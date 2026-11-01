import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SystemStatusView } from "./system-status-view";

describe("SystemStatusView", () => {
  it("shows each check when services are ready", () => {
    render(
      <SystemStatusView
        status={{ state: "ready", checks: { database: "ok", redis: "ok" } }}
      />,
    );
    expect(screen.getByText("All systems available")).toBeInTheDocument();
    expect(screen.getByText("database")).toBeInTheDocument();
    expect(screen.getByText("redis")).toBeInTheDocument();
  });

  it("names the unavailable service", () => {
    render(
      <SystemStatusView
        status={{
          state: "not_ready",
          checks: { database: "unavailable", redis: "ok" },
        }}
      />,
    );
    expect(
      screen.getByText("Some services are unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText(/unavailable$/, { selector: "li" })).toHaveTextContent(
      "database: unavailable",
    );
  });

  it("says so honestly when the API cannot be reached", () => {
    render(<SystemStatusView status={{ state: "unreachable" }} />);
    expect(screen.getByText("API unreachable")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
