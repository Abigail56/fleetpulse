import { Container } from "@/components/layout/container";

export function PageHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-base-300 bg-base-200">
      <Container className="py-14 md:py-20">
        <p className="font-mono text-xs font-medium tracking-widest uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
          {title}
        </h1>
        <div className="mt-5 max-w-2xl text-lg opacity-85">{children}</div>
      </Container>
    </section>
  );
}
