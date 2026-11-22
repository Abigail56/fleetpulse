import Link from "next/link";

import { Container } from "@/components/layout/container";
import { PageHeading } from "@/components/layout/page-heading";

const LEGAL_ENTITY = process.env.NEXT_PUBLIC_LEGAL_ENTITY?.trim();
const LEGAL_CONTACT_EMAIL = process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim();
const LEGAL_ADDRESS = process.env.NEXT_PUBLIC_LEGAL_ADDRESS?.trim();
export const OPERATOR = LEGAL_ENTITY || "the FleetPulse operator (legal identity to be completed)";
export const GOVERNING_LAW = process.env.NEXT_PUBLIC_LEGAL_GOVERNING_LAW?.trim();
const LEGAL_DETAILS_COMPLETE = Boolean(
  LEGAL_ENTITY && LEGAL_CONTACT_EMAIL && LEGAL_ADDRESS && GOVERNING_LAW,
);
const REVIEWED =
  process.env.NEXT_PUBLIC_LEGAL_REVIEWED === "true" && LEGAL_DETAILS_COMPLETE;

export function ContactLine() {
  return (
    <>
      {LEGAL_CONTACT_EMAIL ? (
        <a className="link" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>
          {LEGAL_CONTACT_EMAIL}
        </a>
      ) : (
        <Link className="link" href="/contact">
          our contact form
        </Link>
      )}
      {LEGAL_ADDRESS && `, or by post to ${LEGAL_ADDRESS}`}
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
      </PageHeading>
      <Container className="py-12">
        <div className="flex max-w-3xl flex-col gap-8 text-sm leading-relaxed md:text-base">
          {!REVIEWED && (
            <p className="rounded-box border-l-4 border-warning bg-base-200 p-4 text-sm">
              This is a draft awaiting qualified legal review. It describes how the product works
              today, is not legal advice, and may change before launch.
            </p>
          )}
          {children}
        </div>
      </Container>
    </>
  );
}
