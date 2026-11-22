import Image from "next/image";
import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-w-0 items-center gap-1.5 font-display text-base font-bold tracking-tight sm:gap-2 sm:text-lg md:gap-3 md:text-2xl"
    >
      <Image
        src="/fleetpulse-mark.svg"
        alt=""
        aria-hidden
        width={440}
        height={431}
        className="size-9 shrink-0 object-contain sm:size-11 md:size-14"
      />
      <span className="whitespace-nowrap leading-none">FleetPulse</span>
    </Link>
  );
}
