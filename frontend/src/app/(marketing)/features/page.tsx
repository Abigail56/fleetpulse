import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { PageHeading } from "@/components/layout/page-heading";
import { FEATURE_GROUPS } from "@/features/marketing/content";
import { CtaBand } from "@/features/marketing/cta-band";

export const metadata: Metadata = {
  title: "Features",
  description:
    "GPS tracking, trips, maintenance, fuel and expenses, compliance, alerts, automation and reporting in one fleet platform.",
};

export default function FeaturesPage() {
  return (
    <>
      <PageHeading eyebrow="Features" title="Everything a fleet operation runs on">
        <p>
          These are the capabilities FleetPulse is being built to provide. We
          add them in stages, and we&apos;ll only describe a tracking or payment
          integration as working once it has been connected and tested.
        </p>
      </PageHeading>
      {FEATURE_GROUPS.map((group) => (
        <section
          key={group.id}
          id={group.id}
          className="scroll-mt-20 border-b border-base-300"
        >
          <Container className="grid gap-8 py-14 md:grid-cols-[1fr_2fr] md:gap-12">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">{group.title}</h2>
              <p className="mt-2 opacity-85">{group.summary}</p>
            </div>
            <div className="divide-y divide-base-300">
              {group.items.map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex gap-4 py-5 first:pt-0 last:pb-0">
                  <Icon aria-hidden className="mt-1 size-5 shrink-0 text-primary" />
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1 opacity-85">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </section>
      ))}
      <CtaBand />
    </>
  );
}
