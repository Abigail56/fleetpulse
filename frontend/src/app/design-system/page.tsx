import { Truck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false },
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-base-300 py-8">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const SWATCHES = ["primary", "accent", "neutral", "success", "warning", "error", "info"];

/** Development reference only: returns 404 in production builds. */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main>
      <Container className="py-10">
        <h1 className="mb-8 text-4xl font-bold tracking-tight">Design system</h1>
        <Section title="Colour">
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((name) => (
              <span
                key={name}
                style={{
                  background: `var(--color-${name})`,
                  color: `var(--color-${name}-content)`,
                }}
                className="rounded-field px-4 py-3 font-mono text-xs"
              >
                {name}
              </span>
            ))}
          </div>
        </Section>
        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button disabled>Disabled</Button>
            <ButtonLink href="/" size="lg">
              Link, large
            </ButtonLink>
          </div>
        </Section>
        <Section title="Status">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="success">Moving</StatusBadge>
            <StatusBadge status="neutral">Idle</StatusBadge>
            <StatusBadge status="warning">Stale GPS</StatusBadge>
            <StatusBadge status="error">Offline</StatusBadge>
            <StatusBadge status="info">Simulated</StatusBadge>
          </div>
        </Section>
        <Section title="Alerts">
          <div className="flex flex-col gap-3">
            <Alert variant="info">Information for the reader.</Alert>
            <Alert variant="success">Something finished successfully.</Alert>
            <Alert variant="error">Something went wrong, and what to do next.</Alert>
          </div>
        </Section>
        <Section title="Card and empty state">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <h3 className="font-semibold">Card title</h3>
              <p className="mt-1 opacity-85">Reusable surface for grouped content.</p>
            </Card>
            <EmptyState icon={Truck} title="No vehicles yet">
              Vehicles you add will appear here.
            </EmptyState>
          </div>
        </Section>
        <Section title="Loading">
          <div className="flex flex-col gap-2">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-4 w-1/2" />
          </div>
        </Section>
        <Section title="Forms">
          <div className="grid max-w-md gap-4">
            <Field id="ds-a" label="Text" required hint="Hint text.">
              {(describedBy) => <TextInput id="ds-a" aria-describedby={describedBy} />}
            </Field>
            <Field id="ds-b" label="With error" required error="Explains what to fix.">
              {(describedBy) => (
                <TextInput id="ds-b" aria-invalid aria-describedby={describedBy} />
              )}
            </Field>
            <Field id="ds-c" label="Select">
              {() => (
                <SelectInput id="ds-c">
                  <option>Option</option>
                </SelectInput>
              )}
            </Field>
            <Field id="ds-d" label="Text area">
              {() => <TextArea id="ds-d" rows={3} />}
            </Field>
          </div>
        </Section>
      </Container>
    </main>
  );
}
