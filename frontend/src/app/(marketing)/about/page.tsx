import type { Metadata } from "next";

import { AboutPageContent } from "@/features/marketing/about-page";

export const metadata: Metadata = {
  title: "About FleetPulse",
  description:
    "Learn about FleetPulse, our mission to simplify fleet operations, and our vision for intelligent fleet management.",
  openGraph: {
    title: "About FleetPulse",
    description:
      "Driving smarter operations and powering business growth through intelligent fleet management.",
    type: "website",
  },
};

export default function AboutPage() {
  return <AboutPageContent />;
}
