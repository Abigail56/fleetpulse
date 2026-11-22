import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  ClipboardCheck,
  Compass,
  Database,
  Fuel,
  Globe2,
  KeyRound,
  LockKeyhole,
  MapPinned,
  Route,
  Truck,
  UsersRound,
  Wrench,
} from "lucide-react";

import { Container } from "@/components/layout/container";
import { ButtonLink } from "@/components/ui/button";

const HERO_IMAGE = "/images/about/fleet-on-road.jpg";
const STORY_IMAGE = "/images/about/logistics-warehouse.jpg";

const CAPABILITIES = [
  { icon: Truck, name: "Vehicle management", status: "Built in development app" },
  { icon: UsersRound, name: "Driver management", status: "Built in development app" },
  { icon: MapPinned, name: "Live GPS tracking", status: "Device validation pending" },
  { icon: Route, name: "Trip management", status: "Built in development app" },
  { icon: Wrench, name: "Maintenance", status: "Built in development app" },
  { icon: Fuel, name: "Fuel and expenses", status: "Built in development app" },
  { icon: BarChart3, name: "Reports and analytics", status: "Built in development app" },
];

const SECURITY_CONTROLS = [
  {
    icon: Database,
    title: "Organisation-level data isolation",
    body: "Records are scoped to an organisation in the application, with PostgreSQL row-level security providing an additional database boundary.",
  },
  {
    icon: KeyRound,
    title: "Argon2id password hashing",
    body: "Passwords are stored as one-way Argon2id hashes, not as readable or reversibly encrypted text.",
  },
  {
    icon: LockKeyhole,
    title: "Managed, revocable sessions",
    body: "Signed-in sessions can be reviewed and revoked. Revoked sessions are checked on requests and stop working.",
  },
  {
    icon: ClipboardCheck,
    title: "Role-based access and audit records",
    body: "Explicit role permissions control access, and selected important account and fleet actions are recorded in an audit log.",
  },
];

function Eyebrow({
  children,
  onDark = false,
}: {
  children: React.ReactNode;
  onDark?: boolean;
}) {
  return (
    <p
      className={`text-xs font-semibold uppercase tracking-[0.2em] ${
        onDark ? "text-blue-300" : "text-primary"
      }`}
    >
      {children}
    </p>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  centered = false,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description?: string;
  centered?: boolean;
}) {
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        id={id}
        className="mt-4 font-display text-3xl font-semibold leading-tight tracking-[-0.035em] text-base-content sm:text-4xl lg:text-5xl"
      >
        {title}
      </h2>
      {description && (
        <p className="mt-5 text-base leading-7 text-base-content/75 sm:text-lg sm:leading-8">
          {description}
        </p>
      )}
    </div>
  );
}

export function AboutPageContent() {
  return (
    <div className="overflow-hidden bg-base-100 text-base-content">
      <section aria-labelledby="about-title" className="border-b border-base-300">
        <Container className="grid items-center gap-10 py-14 sm:py-18 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16 lg:py-24">
          <div className="max-w-2xl">
            <Eyebrow>About FleetPulse</Eyebrow>
            <h1
              id="about-title"
              className="mt-5 font-display text-4xl font-semibold leading-[1.08] tracking-[-0.05em] text-base-content sm:text-5xl lg:text-6xl"
            >
              Driving Smarter Operations. Powering Business Growth.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-base-content/75">
              Every vehicle is a valuable asset. Every journey contributes to business performance.
              Every operational decision matters.
            </p>
            <p className="mt-4 max-w-xl text-lg leading-8 text-base-content/75">
              FleetPulse is an innovative fleet management platform designed to transform how
              businesses monitor, manage, and optimize their fleet operations.
            </p>
            <p className="mt-4 max-w-xl text-lg leading-8 text-base-content/75">
              Built with a focus on efficiency, reliability, and scalability, FleetPulse brings
              vehicle tracking, fleet monitoring, driver management, intelligent alerts, and
              operational analytics together in one centralized platform.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/features" size="lg" className="gap-2">
                Explore FleetPulse <ArrowRight aria-hidden className="size-4" />
              </ButtonLink>
              <ButtonLink
                href="/contact"
                size="lg"
                variant="outline"
                className="border-base-content/40 text-base-content hover:bg-base-200"
              >
                Get in Touch
              </ButtonLink>
            </div>
          </div>
          <figure className="relative min-h-[340px] overflow-hidden rounded-sm bg-base-300 sm:min-h-[440px] lg:min-h-[560px]">
            <Image
              src={HERO_IMAGE}
              alt="A commercial truck moving along an open road"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 52vw"
              className="object-cover"
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-slate-950/65 via-transparent to-transparent"
            />
            <figcaption className="absolute inset-x-0 bottom-0 p-6 text-sm font-medium text-white sm:p-8">
              Built for the people and businesses behind every mile.
            </figcaption>
          </figure>
        </Container>
      </section>

      <section aria-labelledby="story-title" className="py-16 sm:py-24">
        <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <figure className="relative order-2 min-h-[320px] overflow-hidden rounded-sm bg-base-300 sm:min-h-[430px] lg:order-1">
            <Image
              src={STORY_IMAGE}
              alt="Freight and logistics operations inside a warehouse"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </figure>
          <div className="order-1 lg:order-2">
            <Eyebrow>About FleetPulse</Eyebrow>
            <h2
              id="story-title"
              className="mt-4 font-display text-3xl font-semibold leading-tight tracking-[-0.035em] text-base-content sm:text-4xl"
            >
              Connecting People, Assets, and Operations
            </h2>
            <div className="mt-6 space-y-4 text-base leading-7 text-base-content/75 sm:text-lg sm:leading-8">
              <p>
                Our goal is to eliminate operational complexities, improve fleet visibility, and
                equip businesses with the insights and tools needed to make informed decisions,
                maximize productivity, and achieve sustainable growth.
              </p>
              <p>
                At FleetPulse, we believe effective fleet management goes beyond tracking vehicles.
                It is about connecting people, assets, and operations through technology that
                delivers measurable business value.
              </p>
            </div>
          </div>
        </Container>
      </section>

      <section aria-label="Our mission and vision" className="bg-base-200 py-16 sm:py-20">
        <Container className="grid gap-px overflow-hidden border border-base-300 bg-base-300 md:grid-cols-2">
          <article className="bg-base-100 p-7 sm:p-10 lg:p-12">
            <div className="flex size-11 items-center justify-center bg-primary/10 text-primary">
              <Compass aria-hidden className="size-5" />
            </div>
            <Eyebrow>Our Mission</Eyebrow>
            <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-base-content sm:text-3xl">
              To simplify fleet operations through intelligent, reliable, and accessible technology.
            </h2>
            <p className="mt-4 text-base leading-7 text-base-content/75">
              We are committed to empowering businesses with real-time visibility, actionable
              insights, and streamlined management tools that enhance operational efficiency,
              strengthen accountability, reduce unnecessary costs, and support informed
              decision-making.
            </p>
            <p className="mt-5 border-l-2 border-primary pl-4 text-sm font-medium leading-6 text-base-content/85">
              Our mission is to make fleet management smarter, more connected, and more effective
              for businesses of all sizes.
            </p>
          </article>
          <article className="bg-base-100 p-7 sm:p-10 lg:p-12">
            <div className="flex size-11 items-center justify-center bg-primary/10 text-primary">
              <Globe2 aria-hidden className="size-5" />
            </div>
            <Eyebrow>Our Vision</Eyebrow>
            <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-base-content sm:text-3xl">
              To become a trusted leader in intelligent fleet management, transforming how
              businesses move, operate, and grow.
            </h2>
            <p className="mt-4 text-base leading-7 text-base-content/75">
              We envision a future where fleet operations are seamlessly connected, data-driven,
              and optimized for efficiency, safety, and sustainability.
            </p>
            <p className="mt-4 text-base leading-7 text-base-content/75">
              Through continuous innovation and a commitment to operational excellence, FleetPulse
              aspires to set new standards for fleet intelligence and empower businesses to
              navigate the future of mobility with confidence.
            </p>
          </article>
        </Container>
      </section>

      <section aria-labelledby="values-title" className="py-16 sm:py-24">
        <Container>
          <SectionHeading
            id="values-title"
            eyebrow="Our Commitment"
            title="Smarter Fleets. Stronger Businesses. Better Journeys."
            description="We are building FleetPulse with a clear commitment to innovation, reliability, transparency, and customer-focused solutions."
            centered
          />
          <p className="mx-auto mt-8 max-w-3xl text-center text-base leading-7 text-base-content/75 sm:text-lg sm:leading-8">
            Our ambition is to help businesses turn everyday fleet challenges into opportunities
            for greater efficiency, stronger performance, and sustainable growth.
          </p>
        </Container>
      </section>

      <section aria-labelledby="ecosystem-title" className="border-y border-base-300 bg-base-200 py-16 sm:py-24">
        <Container className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-start lg:gap-16">
          <div>
            <Eyebrow>More than fleet management</Eyebrow>
            <h2
              id="ecosystem-title"
              className="mt-4 font-display text-3xl font-semibold leading-tight tracking-[-0.035em] text-base-content sm:text-4xl"
            >
              More Than Fleet Management.
            </h2>
            <div className="mt-5 space-y-4 text-base leading-7 text-base-content/75">
              <p>
                FleetPulse is about more than knowing where your vehicles are. It&apos;s about
                understanding how your business moves, identifying opportunities to improve and
                having the confidence to plan what comes next.
              </p>
              <p>
                Whether you&apos;re managing a growing delivery business, a transportation company
                or an established commercial fleet, our goal is to help you spend less time
                managing complexity and more time moving your business forward.
              </p>
            </div>
            <Link
              href="/features"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              Explore the platform <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>

          <div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs font-medium text-base-content/75">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="size-2 rounded-full bg-primary" />
                Built in the development app (not released)
              </span>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="size-2 rounded-full bg-amber-500" />
                Real-device validation still ahead
              </span>
            </div>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {CAPABILITIES.map(({ icon: Icon, name, status }) => {
                const needsValidation = status === "Device validation pending";
                return (
                  <li
                    key={name}
                    className="flex min-h-28 items-start gap-3 border border-base-300 bg-base-100 p-4 sm:p-5"
                  >
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center bg-base-200 text-base-content/80">
                      <Icon aria-hidden className="size-4" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-base-content">{name}</h3>
                      <p
                        className={`mt-1.5 text-xs leading-5 ${
                          needsValidation ? "text-warning" : "text-base-content/65"
                        }`}
                      >
                        {status}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs leading-5 text-base-content/65">
              FleetPulse is in development and is not yet a production fleet service. GPS
              interfaces are built, but connection to a real tracker and field validation are
              still ahead. The public-site map demonstration uses simulated data.
            </p>
          </div>
        </Container>
      </section>

      <section id="security" aria-labelledby="security-title" className="scroll-mt-24 py-16 sm:py-24">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div>
              <Eyebrow>Security &amp; Trust</Eyebrow>
              <h2
                id="security-title"
                className="mt-4 font-display text-3xl font-semibold leading-tight tracking-[-0.035em] text-base-content sm:text-4xl"
              >
                Trust is built into the foundations.
              </h2>
              <p className="mt-5 text-base leading-7 text-base-content/75">
                Fleet and driver information is sensitive. We design the application to make
                access deliberate, keep organisations&apos; records separated and make important
                actions traceable.
              </p>
              <p className="mt-4 text-sm leading-6 text-base-content/75">
                Location data is handled with care. FleetPulse distinguishes simulated and stale
                readings from current device data; no real GPS tracker or vendor integration is
                claimed as field-tested.
              </p>
              <p className="mt-4 text-sm leading-6 text-base-content/65">
                These are controls implemented in the development application—not a claim of
                independent certification or completed production security review.
              </p>
            </div>
            <ul className="divide-y divide-base-300 border-y border-base-300">
              {SECURITY_CONTROLS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4 py-5 first:pt-6 last:pb-6">
                  <div className="flex size-10 shrink-0 items-center justify-center bg-primary/10 text-primary">
                    <Icon aria-hidden className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base-content">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-base-content/75">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="bg-[#111a2b] py-16 text-white sm:py-24">
        <Container className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-3xl">
            <Eyebrow onDark>Build what moves you</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-4xl lg:text-5xl">
              Let&apos;s Shape the Future of Fleet Management Together.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              Every fleet has a story, and we&apos;d love to hear yours.
            </p>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">
              We&apos;re building FleetPulse around real challenges faced by businesses and the
              people behind them. Your experiences, ideas and feedback can help us create a
              platform that truly makes a difference.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <ButtonLink href="/contact" size="lg" className="gap-2 whitespace-nowrap">
              Get in Touch <ArrowRight aria-hidden className="size-4" />
            </ButtonLink>
            <ButtonLink
              href="/features"
              size="lg"
              variant="outline"
              className="whitespace-nowrap border-slate-500 text-white hover:bg-white/10"
            >
              Explore Our Features
            </ButtonLink>
          </div>
          <p className="border-t border-white/15 pt-5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300 lg:col-span-2">
            Better Visibility. Smoother Operations. Greater Peace of Mind.
          </p>
        </Container>
      </section>
    </div>
  );
}
