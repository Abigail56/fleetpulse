import { api } from "@/lib/api/client";

export type PlanKey = "starter" | "growth";
export type SubscriptionState = "trial" | "active" | "grace" | "expired";
export type Plan = {
  key: PlanKey;
  name: string;
  price_per_vehicle: string;
  currency: string;
  max_vehicles: number;
  max_members: number | null;
};
export type BillingStatus = {
  payments_enabled: boolean;
  enforced: boolean;
  state: SubscriptionState;
  plan: PlanKey | null;
  trial_ends_at: string | null;
  paid_until: string | null;
  vehicles_paid_for: number;
  vehicles_used: number;
  members_used: number;
  max_vehicles: number | null;
  max_members: number | null;
};
export type PaymentStatus = "pending" | "paid" | "failed" | "mismatched";
export type Payment = {
  id: string;
  reference: string;
  plan: PlanKey;
  vehicles: number;
  amount: string;
  currency: string;
  status: PaymentStatus;
  created_at: string;
  paid_at: string | null;
};

export const BILLING_KEY = ["billing"];

export const fetchPlans = () => api<Plan[]>("/billing/plans");
export const fetchStatus = () => api<BillingStatus>("/billing/status");
export const fetchPayments = () => api<Payment[]>("/billing/payments");
export const startCheckout = (plan: PlanKey) =>
  api<{ checkout_url: string; reference: string }>("/billing/checkout", {
    method: "POST",
    body: { plan },
  });
