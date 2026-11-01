import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { PageHeading } from "@/components/layout/page-heading";
import { Card } from "@/components/ui/card";
import { SOLUTIONS } from "@/features/marketing/content";
import { CtaBand } from "@/features/marketing/cta-band";

export const metadata: Metadata = {
  title: "Solutions",
  description:
    "How FleetPulse supports logistics, transport, construction, rental, schools, field service and government fleets.",
};

export default function SolutionsPage() {
  return (
    <>
      <PageHeading eyebrow="Solutions" title="Built for fleets of many kinds">
        <p>
          A school bus service and a construction firm run vehicles differently,
          but both need to know where those vehicles are, what they cost and
          whether they&apos;re compliant. FleetPulse is designed for fleets from
          a handful of vehicles to thousands.
        </p>
      </PageHeading>
      <section>
        <Container className="grid gap-4 py-14 sm:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map(({ icon: Icon, title, need }) => (
            <Card key={title}>
              <Icon aria-hidden className="size-6 text-primary" />
              <h2 className="mt-3 text-lg font-semibold">{title}</h2>
              <p className="mt-1 opacity-85">{need}</p>
            </Card>
          ))}
        </Container>
      </section>
      <CtaBand />
    </>
  );
}
