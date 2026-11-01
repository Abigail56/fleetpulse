import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight"
    >
      <svg aria-hidden viewBox="0 0 32 32" className="size-7">
        <rect width="32" height="32" rx="6" fill="#0d3f3f" />
        <path
          d="M4 17h6l3-8 5 15 3-7h7"
          fill="none"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          stroke="#f0a030"
        />
      </svg>
      FleetPulse
    </Link>
  );
}
