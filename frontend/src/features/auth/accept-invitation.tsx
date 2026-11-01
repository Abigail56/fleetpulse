"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { changeSession } from "@/lib/session-change";

import { acceptInvitation } from "./api";
import { useCurrentUser } from "./use-current-user";
import { useOneTimeToken } from "./use-one-time-token";

export function AcceptInvitation() {
  const token = useOneTimeToken();
  const user = useCurrentUser();
  const [error, setError] = useState<string | null>(null);
  const accept = useMutation({
    mutationFn: acceptInvitation,
    onSuccess: () => changeSession("/dashboard"),
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.",
      ),
  });

  if (!token) {
    return <Alert variant="error">This link is incomplete. Please open it from your email again.</Alert>;
  }
  if (user.isPending) {
    return <div className="skeleton h-24 w-full" role="status" aria-label="Loading" />;
  }
  if (user.isError) {
    return <Alert variant="error">{user.error.message}</Alert>;
  }
  if (!user.data) {
    // The token stays in the link so it survives signing in.
    const next = encodeURIComponent(`/accept-invitation?token=${token}`);
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm opacity-85">
          Sign in with the email address the invitation was sent to. If you don&apos;t have an
          account yet, create one with that address, then open the invitation link again.
        </p>
        <ButtonLink href={`/login?next=${next}`}>Sign in to accept</ButtonLink>
        <ButtonLink href="/register" variant="outline">
          Create an account
        </ButtonLink>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm opacity-85">
        You&apos;re signed in as <strong>{user.data.email}</strong>. Invitations only work for the
        address they were sent to.
      </p>
      {error && <Alert variant="error">{error}</Alert>}
      <Button disabled={accept.isPending} onClick={() => accept.mutate(token)}>
        {accept.isPending ? "Joining…" : "Accept invitation"}
      </Button>
    </div>
  );
}
