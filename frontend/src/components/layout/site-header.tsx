"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Logo } from "@/components/layout/logo";
import { NAV_LINKS } from "@/components/layout/nav-links";
import { cn } from "@/lib/cn";
import { ThemeControl } from "@/components/theme/theme-control";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const navLinks = NAV_LINKS.map(({ href, label }) => {
    const current = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        onClick={() => setOpen(false)}
        aria-current={current ? "page" : undefined}
        className={cn(
          "rounded-field px-3 py-2 text-sm font-medium transition-colors hover:bg-primary/10 hover:text-primary",
          current && "bg-primary/10 text-primary",
        )}
      >
        {label}
      </Link>
    );
  });

  return (
    <header className="sticky top-0 z-40 border-b border-primary/15 bg-base-100/90 shadow-sm shadow-primary/5 backdrop-blur-xl">
      <Container className="flex h-16 items-center justify-between gap-3 md:h-20 md:gap-4">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {navLinks}
        </nav>
        <div className="flex items-center gap-1 md:gap-2">
          <ThemeControl className="mr-1" />
          <div className="hidden items-center gap-2 md:flex">
            <ButtonLink href="/login" variant="ghost">
              Sign in
            </ButtonLink>
            <ButtonLink href="/register">Get started</ButtonLink>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-square md:hidden"
          aria-expanded={open}
          aria-controls="mobile-navigation"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X aria-hidden /> : <Menu aria-hidden />}
        </button>
      </Container>
      {open && (
        <nav
          id="mobile-navigation"
          aria-label="Mobile"
          className="border-t border-base-300 bg-base-100 md:hidden"
        >
          <Container className="flex flex-col gap-1 py-3">
            {navLinks}
            <ButtonLink
              href="/login"
              variant="outline"
              className="mt-2"
              onClick={() => setOpen(false)}
            >
              Sign in
            </ButtonLink>
            <ButtonLink href="/register" onClick={() => setOpen(false)}>
              Get started
            </ButtonLink>
          </Container>
        </nav>
      )}
    </header>
  );
}
