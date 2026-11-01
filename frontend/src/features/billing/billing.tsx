"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/money";

import {
  BILLING_KEY,
  type BillingStatus,
  fetchPayments,
  fetchPlans,
  fetchStatus,
  type PaymentStatus,
  type PlanKey,
  startCheckout,
  type SubscriptionState,
} from "./api";

const POLL_MS = 3000;
const STATE_LABELS: Record<SubscriptionState, string> = {
  trial: "Free trial",
  active: "Active",
  grace: "Payment overdue",
  expired: "Ended",
};
const STATE_STYLES: Record<SubscriptionState, Status> = {
  trial: "info",
  active: "success",
  grace: "warning",
  expired: "error",
};
const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  pending: "Not confirmed",
  paid: "Paid",
  failed: "Failed",
  mismatched: "Needs review",
};
const PAYMENT_STYLES: Record<PaymentStatus, Status> = {
  pending: "neutral",
  paid: "success",
  failed: "error",
  mismatched: "warning",
};

const day = (iso: string) => format(new Date(iso), "d MMM yyyy");

function Summary({ status }: { status: BillingStatus }) {
  const rows: [string, string][] = [
    ["Vehicles", `${status.vehicles_used}${status.max_vehicles ? ` of ${status.max_vehicles}` : ""}`],
    ["Team members", `${status.members_used}${status.max_members ? ` of ${status.max_members}` : ""}`],
    ...(status.trial_ends_at ? ([["Trial ends", day(status.trial_ends_at)]] as [string, string][]) : []),
    ...(status.paid_until ? ([["Paid until", day(status.paid_until)]] as [string, string][]) : []),
    ...(status.paid_until
      ? ([["Vehicles paid for", String(status.vehicles_paid_for)]] as [string, string][])
      : []),
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Your subscription</h2>
        <StatusBadge status={STATE_STYLES[status.state]}>{STATE_LABELS[status.state]}</StatusBadge>
      </div>
      <dl className="mt-3 divide-y divide-base-300 border-y border-base-300 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 py-2.5 sm:grid-cols-[1fr_2fr]">
            <dt className="font-medium">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {status.state === "grace" && (
        <p className="mt-3 text-sm">Your payment period has ended. Pay within a week to keep adding to your fleet.</p>
      )}
      {status.state === "expired" && (
        <p className="mt-3 text-sm">
          Your data is safe and you can still use it, but you can&apos;t add vehicles or invite people until you
          pay{status.enforced ? "" : ", once limits are switched on"}.
        </p>
      )}
    </Card>
  );
}

export function Billing() {
  const returnedReference = useSearchParams().get("reference");
  const status = useQuery({ queryKey: [...BILLING_KEY, "status"], queryFn: fetchStatus });
  const plans = useQuery({ queryKey: [...BILLING_KEY, "plans"], queryFn: fetchPlans });
  const payments = useQuery({
    queryKey: [...BILLING_KEY, "payments"],
    queryFn: fetchPayments,
    // Coming back from the payment page proves nothing: this waits for the provider to confirm.
    refetchInterval: (query) => {
      const match = query.state.data?.find((item) => item.reference === returnedReference);
      return returnedReference && (!match || match.status === "pending") ? POLL_MS : false;
    },
  });
  const checkout = useMutation({
    mutationFn: (plan: PlanKey) => startCheckout(plan),
    onSuccess: ({ checkout_url: url }) => {
      window.location.assign(url);
    },
    onError: (error) => toast.error(error.message),
  });
  const returned = payments.data?.find((item) => item.reference === returnedReference);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
      {returnedReference && (!returned || returned.status === "pending") && (
        <Alert variant="info">
          We&apos;re waiting for the payment provider to confirm your payment. This page updates by itself. Your
          subscription changes only once it&apos;s confirmed.
        </Alert>
      )}
      {returned?.status === "paid" && <Alert variant="success">Payment confirmed. Thank you.</Alert>}
      {returned?.status === "failed" && <Alert variant="error">That payment didn&apos;t go through. You haven&apos;t been given a new period, and can try again.</Alert>}
      {returned?.status === "mismatched" && (
        <Alert variant="error">
          The amount received didn&apos;t match what was due, so your subscription hasn&apos;t changed. Please contact us.
        </Alert>
      )}
      {status.isPending && <p role="status" className="text-sm opacity-75">Loading billing…</p>}
      {status.isError && (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{status.error.message}</Alert>
          <Button variant="outline" onClick={() => void status.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {status.data && <Summary status={status.data} />}
      {status.data && !status.data.payments_enabled && (
        <Alert variant="info">
          Online payment isn&apos;t set up yet, so there&apos;s nothing to pay and no limits apply. Prices below are
          what&apos;s planned for launch.
        </Alert>
      )}
      {plans.isError && <Alert variant="error">{plans.error.message}</Alert>}
      {plans.data && status.data && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Plans</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.data.map((plan) => {
              const tooSmall = status.data.vehicles_used > plan.max_vehicles;
              const units = Math.max(status.data.vehicles_used, 1);
              return (
                <Card key={plan.key} className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <p>
                    <span className="text-2xl font-bold">{formatMoney(plan.price_per_vehicle, plan.currency)}</span>{" "}
                    <span className="text-xs opacity-75">per vehicle / 30 days</span>
                  </p>
                  <p className="flex-1 text-sm opacity-85">
                    Up to {plan.max_vehicles} vehicles,{" "}
                    {plan.max_members ? `${plan.max_members} team members` : "unlimited team members"}.
                  </p>
                  {status.data.payments_enabled && (
                    <>
                      <p className="text-xs opacity-75">
                        {formatMoney(Number(plan.price_per_vehicle) * units, plan.currency)} for your {units}{" "}
                        {units === 1 ? "vehicle" : "vehicles"}
                      </p>
                      <Button
                        variant="outline"
                        disabled={checkout.isPending || tooSmall}
                        onClick={() => checkout.mutate(plan.key)}
                      >
                        {tooSmall ? "Too small for your fleet" : `Pay for ${plan.name}`}
                      </Button>
                    </>
                  )}
                </Card>
              );
            })}
            <Card className="flex flex-col gap-2">
              <h3 className="text-lg font-semibold">Enterprise</h3>
              <p className="flex-1 text-sm opacity-85">More than 250 vehicles, with terms agreed with you.</p>
              <ButtonLink href="/contact" variant="ghost">
                Talk to us
              </ButtonLink>
            </Card>
          </div>
        </section>
      )}
      {payments.data && payments.data.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Payment history</h2>
          <Card className="overflow-hidden p-0">
            <ul aria-label="Payment history" className="divide-y divide-base-300 text-sm">
              {payments.data.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span>
                    <span className="font-medium tabular-nums">{formatMoney(item.amount, item.currency)}</span>
                    <span className="block text-xs opacity-75">
                      {day(item.created_at)} · {item.vehicles} {item.vehicles === 1 ? "vehicle" : "vehicles"}
                    </span>
                  </span>
                  <StatusBadge status={PAYMENT_STYLES[item.status]}>{PAYMENT_LABELS[item.status]}</StatusBadge>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
