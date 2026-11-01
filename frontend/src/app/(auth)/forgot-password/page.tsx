import type { Metadata } from "next";
import { Suspense } from "react";

import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
      <p className="mt-1 mb-5 text-sm opacity-75">We&apos;ll email you a link to choose a new one.</p>
      <Suspense fallback={<div className="skeleton h-40 w-full" />}>
        <ForgotPasswordForm />
      </Suspense>
    </>
  );
}
