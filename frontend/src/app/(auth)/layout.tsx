import type { Metadata } from "next";

import { Logo } from "@/components/layout/logo";
import { Providers } from "@/app/providers";

export const metadata: Metadata = { robots: { index: false } };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <main className="flex flex-1 items-center justify-center bg-base-200 px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-6 flex justify-center">
            <Logo />
          </div>
          <div className="rounded-box border border-base-300 bg-base-100 p-6 sm:p-8">
            {children}
          </div>
        </div>
      </main>
    </Providers>
  );
}
