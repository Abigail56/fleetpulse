import type { Metadata } from "next";
import { Suspense } from "react";

import { RegisterForm } from "@/features/auth/register-form";

export const metadata: Metadata = { title: "Create your account" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-1 mb-5 text-sm opacity-75">Start by telling us who you are.</p>
      <Suspense fallback={<div className="skeleton h-40 w-full" />}>
        <RegisterForm />
      </Suspense>
    </>
  );
}
