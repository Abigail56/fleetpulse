import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { PageHeading } from "@/components/layout/page-heading";
import { ContactForm } from "@/features/contact/contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Tell the FleetPulse team about your fleet.",
};

export default function ContactPage() {
  return (
    <>
      <PageHeading eyebrow="Contact" title="Talk to us">
        <p>Tell us about your fleet and what you need from it.</p>
      </PageHeading>
      <section>
        <Container className="py-14">
          <div className="max-w-2xl">
            <ContactForm />
          </div>
        </Container>
      </section>
    </>
  );
}
