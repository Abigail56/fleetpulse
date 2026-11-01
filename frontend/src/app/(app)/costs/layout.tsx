import type { Metadata } from "next";

export const metadata: Metadata = { title: "Fuel and expenses" };

export default function CostsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
