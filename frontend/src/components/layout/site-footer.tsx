import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Logo } from "@/components/layout/logo";

const FOOTER_GROUPS = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/solutions", label: "Solutions" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Trust & Legal",
    links: [
      { href: "/about#security", label: "Security & Trust" },
      { href: "/terms", label: "Terms of Service" },
      { href: "/privacy", label: "Privacy Policy" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-primary/15 bg-base-200">
      <Container className="grid gap-10 py-12 md:grid-cols-[1.4fr_2fr] md:gap-16 lg:py-14">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3 text-sm leading-6 text-base-content/70">
            Every Vehicle. Every Journey. Under Control.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {FOOTER_GROUPS.map(({ title, links }) => (
            <nav key={title} aria-label={title} className="flex flex-col items-start gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-base-content">
                {title}
              </h2>
              {links.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="text-sm text-base-content/75 transition-colors hover:text-primary focus-visible:text-primary"
                >
                  {label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
      </Container>
    </footer>
  );
}
