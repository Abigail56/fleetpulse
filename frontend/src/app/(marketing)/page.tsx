import { ArrowRight, CircleDot, FlaskConical, History } from "lucide-react";
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
      <section className="border-b border-base-300 bg-base-200">
        <Container className="grid items-center gap-12 py-14 md:py-20 lg:grid-cols-[5fr_7fr]">
          <div>
            <h1 className="text-5xl font-extrabold tracking-tight md:text-6xl lg:text-5xl xl:text-[3.5rem]">
              <span className="block">Every Vehicle.</span>{" "}
              <span className="block">Every Journey.</span>{" "}
              <span className="block">Under Control.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg opacity-85">
              FleetPulse brings your vehicles, drivers, trips, maintenance, and
              operating costs together in one intelligent platform. Monitor your
              fleet, understand what&apos;s happening, and make better
              operational decisions.
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
          </div>
          <LiveFleet />
        </Container>
      </section>

      <section>
        <Container className="py-16 md:py-24">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight md:text-4xl">
            One place to see, understand and act
          </h2>
          <div className="mt-10 divide-y divide-base-300 border-y border-base-300">
            {FEATURE_GROUPS.map((group, index) => (
              <div
                key={group.id}
                className="grid gap-4 py-8 md:grid-cols-[4rem_1fr_2fr] md:gap-8"
              >
                <span className="font-mono text-sm opacity-65">
                  0{index + 1}
                </span>
                <h3 className="text-xl font-semibold">{group.title}</h3>
                <div>
                  <p className="opacity-85">{group.summary}</p>
                  <p className="mt-2 text-sm opacity-70">
                    {group.items.map((item) => item.title).join(" · ")}
                  </p>
                  <Link
                    href={`/features#${group.id}`}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
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

      <section className="border-y border-base-300 bg-base-200">
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
              <div key={title}>
                <Icon aria-hidden className="size-6 text-primary" />
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
            {SOLUTIONS.map(({ title }) => (
              <li
                key={title}
                className="rounded-field border border-base-300 px-3 py-1.5 text-sm"
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
