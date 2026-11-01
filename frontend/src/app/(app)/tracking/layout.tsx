import type { Metadata } from "next";

export const metadata: Metadata = { title: "Tracking" };

export default function TrackingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
