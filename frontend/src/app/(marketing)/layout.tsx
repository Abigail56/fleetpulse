import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Container } from "@/components/layout/container";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-field bg-primary px-4 py-2 text-primary-content focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <aside
        aria-label="Development notice"
        className="border-b border-base-300 bg-base-100"
      >
        <Container className="py-1.5 text-center text-xs opacity-70">
          FleetPulse is in development. This site describes what we&apos;re
          building, and not every feature is available yet.
        </Container>
      </aside>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
