import { ArrowRight, CircleDot, FlaskConical, History, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { ButtonLink } from "@/components/ui/button";
import { FEATURE_GROUPS, SOLUTIONS } from "@/features/marketing/content";
import { LiveFleet } from "@/features/fleet-map/live-fleet";
import { CtaBand } from "@/features/marketing/cta-band";

const HONEST_DATA = [
  {
    icon: History,
    title: "Stale data looks stale",
    body: "If a vehicle stops reporting, you see when it last did, not an old position presented as current.",
  },
  {
    icon: FlaskConical,
    title: "Simulated means labelled",
    body: "Test data is marked at the source and turned off in production by default.",
  },
  {
    icon: CircleDot,
    title: "Empty stays empty",
    body: "Dashboards show numbers from your records. If there's no data yet, they say so.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="marketing-hero relative isolate overflow-hidden border-b border-base-300">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-36 -top-40 -z-10 size-[34rem] rounded-full border border-primary/20"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 -z-10 size-[26rem] rounded-full border border-accent/40"
        />
        <Container className="grid items-center gap-10 py-14 md:gap-12 md:py-20 lg:grid-cols-[5fr_7fr] lg:py-24">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-base-100/85 px-3 py-1.5 text-xs font-semibold tracking-wide text-primary shadow-sm">
              <span aria-hidden className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-40 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              Fleet management, thoughtfully connected
            </p>
            <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-[-0.045em] md:text-6xl lg:text-5xl xl:text-[3.75rem]">
              <span className="block">Every Vehicle.</span>
              {" "}
              <span className="block bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-transparent">Every Journey.</span>
              {" "}
              <span className="block">Under Control.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-base-content/75 sm:text-lg sm:leading-8">
              Bring vehicles, drivers, trips, maintenance and operating costs into one clearer
              view. FleetPulse is being built to help teams make informed decisions and keep
              business moving.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/contact" size="lg">
                Talk to us
                <ArrowRight aria-hidden className="size-4" />
              </ButtonLink>
              <ButtonLink href="/features" size="lg" variant="outline">
                See the features
              </ButtonLink>
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-base-300 pt-5 text-xs font-medium text-base-content/65">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck aria-hidden className="size-4 text-emerald-600 dark:text-emerald-400" />
                Clear about data and development
              </span>
              <span className="inline-flex items-center gap-2">
                <CircleDot aria-hidden className="size-3.5 text-primary" />
                Designed around real fleet operations
              </span>
            </div>
          </div>
          <div className="marketing-showcase min-w-0 rounded-[1.5rem] p-2 shadow-2xl shadow-primary/15 sm:p-3">
            <LiveFleet />
          </div>
        </Container>
      </section>

      <section className="bg-base-100">
        <Container className="py-16 md:py-24">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight md:text-4xl">
            One place to see, understand and act
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_GROUPS.map((group, index) => (
              <div
                key={group.id}
                className={`rounded-box border border-base-300 border-t-4 bg-base-200/65 p-5 shadow-sm transition-transform hover:-translate-y-1 hover:shadow-lg ${
                  ["border-t-primary", "border-t-secondary", "border-t-accent", "border-t-info", "border-t-success", "border-t-warning"][index % 6]
                }`}
              >
                <span className="font-mono text-xs font-semibold tracking-[0.18em] text-primary">
                  0{index + 1}
                </span>
                <h3 className="mt-3 text-xl font-semibold">{group.title}</h3>
                <div>
                  <p className="mt-2 text-sm leading-6 text-base-content/80">{group.summary}</p>
                  <p className="mt-3 text-xs leading-5 text-base-content/60">
                    {group.items.map((item) => item.title).join(" · ")}
                  </p>
                  <Link
                    href={`/features#${group.id}`}
                    className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    More about {group.title.toLowerCase()}
                    <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-y border-base-300 bg-gradient-to-br from-primary/10 via-base-200 to-accent/15">
        <Container className="py-16 md:py-24">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight md:text-4xl">
            Decisions need data you can trust
          </h2>
          <p className="mt-4 max-w-2xl text-lg opacity-85">
            A confident dashboard showing the wrong thing is worse than no
            dashboard. FleetPulse is built to be clear about what it knows.
          </p>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {HONEST_DATA.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-box border border-base-300 bg-base-100/85 p-5 shadow-sm">
                <span className="grid size-11 place-items-center rounded-box bg-primary/10 text-primary">
                  <Icon aria-hidden className="size-6" />
                </span>
                <h3 className="mt-3 text-lg font-semibold">{title}</h3>
                <p className="mt-1 opacity-85">{body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section>
        <Container className="py-16 md:py-24">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight md:text-4xl">
            For any organisation that runs vehicles
          </h2>
          <ul className="mt-8 flex flex-wrap gap-2">
            {SOLUTIONS.map(({ title }, index) => (
              <li
                key={title}
                className={`rounded-full border px-4 py-2 text-sm font-medium ${
                  ["border-primary/30 bg-primary/10 text-primary", "border-secondary/30 bg-secondary/10 text-secondary", "border-accent/50 bg-accent/25 text-base-content"][index % 3]
                }`}
              >
                {title}
              </li>
            ))}
          </ul>
          <Link
            href="/solutions"
            className="mt-6 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
          >
            How FleetPulse fits each one
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
