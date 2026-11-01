import type { Metadata } from "next";

export const metadata: Metadata = { title: "Trips" };

export default function TripsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
