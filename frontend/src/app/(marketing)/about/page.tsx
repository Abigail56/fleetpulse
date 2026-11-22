import type { Metadata } from "next";

import { AboutPageContent } from "@/features/marketing/about-page";

export const metadata: Metadata = {
  title: "About FleetPulse",
  description:
    "Discover why we're building FleetPulse: clearer fleet operations, connected teams and greater confidence on every journey.",
  openGraph: {
    title: "About FleetPulse",
    description:
      "A fleet platform in development, built around the vehicles, drivers and teams that keep businesses moving.",
    type: "website",
  },
};

export default function AboutPage() {
  return <AboutPageContent />;
}
