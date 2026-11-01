import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Logo } from "@/components/layout/logo";
import { NAV_LINKS } from "@/components/layout/nav-links";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-base-300 bg-base-200">
      <Container className="flex flex-col gap-8 py-10 md:flex-row md:items-start md:justify-between">
        <div>
          <Logo />
          <p className="mt-2 text-sm opacity-75">
            Every Vehicle. Every Journey. Under Control.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {[
            ...NAV_LINKS,
            { href: "/contact", label: "Contact" },
            { href: "/terms", label: "Terms" },
            { href: "/privacy", label: "Privacy" },
          ].map(
            ({ href, label }) => (
              <Link key={href} href={href} className="link-hover">
                {label}
              </Link>
            ),
          )}
        </nav>
      </Container>
    </footer>
  );
}
