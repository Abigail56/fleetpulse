import type { Metadata } from "next";
import { Suspense } from "react";

import { VerifyEmailForm } from "@/features/auth/verify-email-form";

export const metadata: Metadata = { title: "Verify your email" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Verify your email</h1>
      <p className="mt-1 mb-5 text-sm opacity-75">One last step to activate your account.</p>
      <Suspense fallback={<div className="skeleton h-40 w-full" />}>
        <VerifyEmailForm />
      </Suspense>
    </>
  );
}
