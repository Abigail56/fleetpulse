import Link from "next/link";

import { Container } from "@/components/layout/container";
import { PageHeading } from "@/components/layout/page-heading";

export const LAST_UPDATED = "30 October 2026";

// Business facts only the operator can supply. Nothing is guessed if they're missing.
export const OPERATOR = process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? "the company that operates FleetPulse";
export const GOVERNING_LAW = process.env.NEXT_PUBLIC_LEGAL_GOVERNING_LAW;
const REVIEWED = process.env.NEXT_PUBLIC_LEGAL_REVIEWED === "true";

export function ContactLine() {
  const email = process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL;
  const address = process.env.NEXT_PUBLIC_LEGAL_ADDRESS;
  return (
    <>
      {email ? (
        <a className="link" href={`mailto:${email}`}>
          {email}
        </a>
      ) : (
        <Link className="link" href="/contact">
          our contact form
        </Link>
      )}
      {address && `, or by post to ${address}`}
    </>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export function BulletList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function LegalPage({
  eyebrow,
  title,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageHeading eyebrow={eyebrow} title={title}>
        <p>{summary}</p>
        <p className="mt-2 text-sm">Last updated: {LAST_UPDATED}</p>
      </PageHeading>
      <Container className="py-12">
        <div className="flex max-w-3xl flex-col gap-8 text-sm leading-relaxed md:text-base">
          {!REVIEWED && (
            <p className="rounded-box border-l-4 border-warning bg-base-200 p-4 text-sm">
              This is a draft awaiting legal review, and FleetPulse is still in development. It
              describes how the product works today, and may change before launch.
            </p>
          )}
          {children}
        </div>
      </Container>
    </>
  );
}
