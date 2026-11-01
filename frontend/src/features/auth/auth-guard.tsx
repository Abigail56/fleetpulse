"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { useCurrentUser } from "./use-current-user";

/** Decides what to display. It isn't a security boundary: the API authorises every request. */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();
  const signedOut = user.isSuccess && user.data === null;

  useEffect(() => {
    if (signedOut) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [signedOut, router, pathname]);

  if (user.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">{user.error.message}</Alert>
        <Button variant="outline" onClick={() => user.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!user.data) {
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-3">
        <div className="skeleton h-8 w-1/2" />
        <div className="skeleton h-32 w-full" />
      </div>
    );
  }
  return children;
}
