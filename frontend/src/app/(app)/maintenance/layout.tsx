import type { Metadata } from "next";

export const metadata: Metadata = { title: "Maintenance" };

export default function MaintenanceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
