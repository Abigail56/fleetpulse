import type { Metadata } from "next";
import { Suspense } from "react";

import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
      <p className="mt-1 mb-5 text-sm opacity-75">This signs you out on every device.</p>
      <Suspense fallback={<div className="skeleton h-40 w-full" />}>
        <ResetPasswordForm />
      </Suspense>
    </>
  );
}
