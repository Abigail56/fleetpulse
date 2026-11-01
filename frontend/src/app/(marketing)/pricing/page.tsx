import { Check } from "lucide-react";
import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { PageHeading } from "@/components/layout/page-heading";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "FleetPulse launch pricing: Starter at $9 and Growth at $15 per vehicle per month, with custom plans for larger fleets.",
};

const PLANS = [
  {
    name: "Starter",
    price: "$9",
    unit: "per vehicle / month",
    summary: "For small fleets getting their vehicles and drivers in one place.",
    points: ["Up to 25 vehicles", "Up to 5 team members", "Email support"],
    cta: { href: "/register", label: "Get started" },
  },
  {
    name: "Growth",
    price: "$15",
    unit: "per vehicle / month",
    summary: "For growing operations with several people running the fleet.",
    points: ["Up to 250 vehicles", "Unlimited team members", "Priority email support"],
    cta: { href: "/register", label: "Get started" },
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "agreed with you",
    summary: "For larger fleets that need a contract and tailored onboarding.",
    points: ["More than 250 vehicles", "Unlimited team members", "Agreed support terms"],
    cta: { href: "/contact", label: "Talk to us" },
  },
];

const INCLUDED = [
  "Vehicle and driver records",
  "Live fleet map with route history",
  "Trip planning, dispatch and trip history",
  "Geofences and operational alerts",
  "Maintenance schedules, work orders and service history",
  "Fuel records, expenses with approval, and receipts",
  "Inspections, defects, documents and expiry reminders",
  "Email and in-app notifications, and automation rules",
  "Reports with CSV and PDF export",
  "GPS feed for your tracking devices",
  "Roles, audit log and session controls",
];

const NOTES = [
  {
    title: "What's counted",
    body: "Each active vehicle in your organisation for the month. Archived vehicles aren't counted.",
  },
  {
    title: "What's not included",
    body: "GPS hardware and its data plans, which come from your device supplier. Prices are in US dollars and exclude tax.",
  },
  {
    title: "Still being built",
    body: "Integrations with other business systems are planned where there's a real need.",
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHeading eyebrow="Pricing" title="Simple pricing per vehicle">
        <p>
          Pay for the vehicles you run, with every released feature on every plan. These are
          planned launch prices, and nobody is charged until online payment goes live.
        </p>
      </PageHeading>
      <section>
        <Container className="py-14">
          <div className="grid gap-6 md:grid-cols-3">
            {PLANS.map(({ name, price, unit, summary, points, cta }) => (
              <Card key={name} className="flex flex-col gap-4 p-6">
                <h2 className="text-xl font-semibold">{name}</h2>
                <p>
                  <span className="text-4xl font-bold tracking-tight">{price}</span>{" "}
                  <span className="text-sm opacity-75">{unit}</span>
                </p>
                <p className="text-sm opacity-85">{summary}</p>
                <ul className="flex flex-1 flex-col gap-2 text-sm">
                  {points.map((point) => (
                    <li key={point} className="flex items-start gap-2">
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
                <ButtonLink href={cta.href} variant={name === "Growth" ? "primary" : "outline"}>
                  {cta.label}
                </ButtonLink>
              </Card>
            ))}
          </div>
          <h2 className="mt-14 text-2xl font-bold tracking-tight">On every plan</h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <Check aria-hidden className="mt-1 size-4 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
          <dl className="mt-10 divide-y divide-base-300 border-y border-base-300">
            {NOTES.map(({ title, body }) => (
              <div key={title} className="grid gap-1 py-5 md:grid-cols-[1fr_2fr]">
                <dt className="font-semibold">{title}</dt>
                <dd className="opacity-85">{body}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>
    </>
  );
}
