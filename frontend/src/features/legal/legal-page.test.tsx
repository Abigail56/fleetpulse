import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("keeps legal pages marked as drafts when required operator details are missing", async () => {
  vi.stubEnv("NEXT_PUBLIC_LEGAL_REVIEWED", "true");
  vi.stubEnv("NEXT_PUBLIC_LEGAL_CONTACT_EMAIL", "legal@example.com");
  vi.stubEnv("NEXT_PUBLIC_LEGAL_GOVERNING_LAW", "Nigeria");

  const { LegalPage } = await import("./legal-page");
  render(
    <LegalPage eyebrow="Legal" title="Terms" summary="Summary">
      <p>Terms content</p>
    </LegalPage>,
  );

  expect(screen.getByText(/draft awaiting qualified legal review/i)).toBeInTheDocument();
  expect(screen.queryByText(/last updated:/i)).not.toBeInTheDocument();
});

it("hides the draft notice only after review and required details are configured", async () => {
  vi.stubEnv("NEXT_PUBLIC_LEGAL_REVIEWED", "true");
  vi.stubEnv("NEXT_PUBLIC_LEGAL_ENTITY", "FleetPulse Limited");
  vi.stubEnv("NEXT_PUBLIC_LEGAL_CONTACT_EMAIL", "legal@example.com");
  vi.stubEnv("NEXT_PUBLIC_LEGAL_ADDRESS", "1 Example Street, Lagos");
  vi.stubEnv("NEXT_PUBLIC_LEGAL_GOVERNING_LAW", "Nigeria");

  const { LegalPage } = await import("./legal-page");
  render(
    <LegalPage eyebrow="Legal" title="Terms" summary="Summary">
      <p>Terms content</p>
    </LegalPage>,
  );

  expect(screen.queryByText(/draft awaiting qualified legal review/i)).not.toBeInTheDocument();
});
