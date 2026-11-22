import Image from "next/image";
import Link from "next/link";
import {
  Activity,
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
  ShieldCheck,
  Truck,
  UsersRound,
  Wrench,
} from "lucide-react";

import { Container } from "@/components/layout/container";
import { ButtonLink } from "@/components/ui/button";

const HERO_IMAGE = "/images/about/fleet-on-road.jpg";
const STORY_IMAGE = "/images/about/logistics-warehouse.jpg";

const VALUES = [
  {
    icon: MapPinned,
    title: "Clarity in Every Journey",
    body: "Better decisions begin with reliable information. We're building FleetPulse to provide meaningful insights without misleading numbers or inaccurate tracking data.",
  },
  {
    icon: UsersRound,
    title: "Built Around Real People",
    body: "Technology should make work easier, not harder. From fleet managers and business owners to drivers and operations teams, we're designing FleetPulse around the people who keep businesses moving.",
  },
  {
    icon: ShieldCheck,
    title: "Trust Comes First",
    body: "Your business deserves a platform that takes security and privacy seriously. Protecting your information and keeping your organisation's data separate are fundamental to how we're building FleetPulse.",
  },
  {
    icon: Globe2,
    title: "Designed Without Borders",
    body: "Every business operates differently. FleetPulse is being designed to support different countries, currencies, time zones and operating environments.",
  },
  {
    icon: Activity,
    title: "Always Moving Forward",
    body: "We believe there is always a better way to do things. We're committed to listening, learning and improving FleetPulse as the needs of businesses evolve.",
  },
];

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
              Moving Businesses Forward, One Journey at a Time.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-base-content/75">
              Behind every vehicle on the road is a business with somewhere to go, a driver with a
              responsibility and a team working to make every journey successful.
            </p>
            <p className="mt-4 max-w-xl text-lg leading-8 text-base-content/75">
              FleetPulse is being built to simplify fleet management, connect operations and give
              businesses the confidence to keep moving forward.
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
            <Eyebrow>Our story</Eyebrow>
            <h2
              id="story-title"
              className="mt-4 font-display text-3xl font-semibold leading-tight tracking-[-0.035em] text-base-content sm:text-4xl"
            >
              Built for the Road. Designed for the People Behind It.
            </h2>
            <div className="mt-6 space-y-4 text-base leading-7 text-base-content/75 sm:text-lg sm:leading-8">
              <p>
                Managing a fleet isn&apos;t always straightforward. Between rising fuel costs,
                unexpected breakdowns, driver coordination and scattered records, keeping
                everything under control can become overwhelming.
              </p>
              <p className="font-semibold text-base-content">That&apos;s why we&apos;re building FleetPulse.</p>
              <p>
                We believe fleet management should be simpler, more connected and less stressful.
                By bringing vehicles, drivers, journeys, maintenance and operating costs together,
                FleetPulse is designed to give businesses the visibility and confidence they need
                to manage their operations.
              </p>
              <p>
                Our goal is to help businesses spend less time managing complexity and more time
                moving forward.
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
              Make fleet operations easier to run.
            </h2>
            <p className="mt-4 text-base leading-7 text-base-content/75">
              To simplify fleet operations and empower businesses to make better decisions, reduce
              unnecessary costs and build safer, more reliable transportation operations.
            </p>
            <p className="mt-5 border-l-2 border-primary pl-4 text-sm font-medium leading-6 text-base-content/85">
              We believe managing a fleet should never be more complicated than the journey itself.
            </p>
          </article>
          <article className="bg-base-100 p-7 sm:p-10 lg:p-12">
            <div className="flex size-11 items-center justify-center bg-primary/10 text-primary">
              <Globe2 aria-hidden className="size-5" />
            </div>
            <Eyebrow>Our Vision</Eyebrow>
            <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-base-content sm:text-3xl">
              Confidence on every road ahead.
            </h2>
            <p className="mt-4 text-base leading-7 text-base-content/75">
              A future where businesses of every size can manage their fleets with confidence,
              where every vehicle is accounted for, every journey matters and technology makes
              transportation more efficient, reliable and sustainable.
            </p>
          </article>
        </Container>
      </section>

      <section aria-labelledby="values-title" className="py-16 sm:py-24">
        <Container>
          <SectionHeading
            id="values-title"
            eyebrow="Our values"
            title="What Drives Us"
            description="The principles behind every decision we make and every feature we build."
            centered
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {VALUES.map(({ icon: Icon, title, body }, index) => (
              <article
                key={title}
                className={`group border border-base-300 bg-base-100 p-6 transition duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg hover:shadow-base-content/5 motion-reduce:transition-none ${
                  index === 3 ? "lg:col-start-1" : ""
                }`}
              >
                <div className="flex size-10 items-center justify-center bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-content">
                  <Icon aria-hidden className="size-5" />
                </div>
                <h3 className="mt-5 font-display text-xl font-semibold tracking-tight text-base-content">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-base-content/75 sm:text-base sm:leading-7">
                  {body}
                </p>
              </article>
            ))}
          </div>
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
