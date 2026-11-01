import { ArrowRight } from "lucide-react";

import { Container } from "@/components/layout/container";
import { ButtonLink } from "@/components/ui/button";

export function CtaBand() {
  return (
    <section className="bg-neutral text-neutral-content">
      <Container className="flex flex-col items-start justify-between gap-6 py-14 md:flex-row md:items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Tell us how your fleet runs.
          </h2>
          <p className="mt-2 max-w-xl opacity-85">
            We&apos;re shaping FleetPulse around real fleet operations, and
            we&apos;d like to hear about yours.
          </p>
        </div>
        <ButtonLink href="/contact" variant="accent" size="lg" className="shrink-0">
          Talk to us
          <ArrowRight aria-hidden className="size-4" />
        </ButtonLink>
      </Container>
    </section>
  );
}
