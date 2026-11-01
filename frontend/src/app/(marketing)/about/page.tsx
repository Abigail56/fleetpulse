import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { PageHeading } from "@/components/layout/page-heading";
import { CtaBand } from "@/features/marketing/cta-band";

export const metadata: Metadata = {
  title: "About",
  description:
    "FleetPulse is fleet management software built around honest data and secure, separated customer records.",
};

const PRINCIPLES = [
  {
    title: "Show what's true",
    body: "No invented metrics, and no old or simulated location data passed off as live. If we don't know something, the product says so.",
  },
  {
    title: "Keep each customer's data separate",
    body: "Each organisation's records are isolated in the application and again in the database, so a mistake in one layer doesn't expose them to another customer.",
  },
  {
    title: "Own the security basics",
    body: "Passwords are hashed with Argon2id, sessions can be reviewed and revoked, and important actions are recorded in an audit log.",
  },
  {
    title: "Work anywhere",
    body: "Countries, currencies, time zones and distance units are set by each organisation, with no single market assumed.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHeading eyebrow="About" title="Why we're building FleetPulse">
        <p>
          Running vehicles means juggling locations, drivers, repairs, fuel and
          paperwork, often across separate systems. FleetPulse brings them
          together so organisations can see their whole operation and make
          better decisions about it.
        </p>
      </PageHeading>
      <section>
        <Container className="py-14">
          <h2 className="text-2xl font-bold tracking-tight">
            How we approach it
          </h2>
          <div className="mt-8 grid gap-x-12 gap-y-8 md:grid-cols-2">
            {PRINCIPLES.map(({ title, body }) => (
              <div key={title} className="border-t-2 border-primary pt-4">
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-1 opacity-85">{body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>
      <CtaBand />
    </>
  );
}
