"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Fuel, Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { useCurrentUser } from "@/features/auth/use-current-user";
import type { CurrentMembership } from "@/features/organisation/api";
import { type DistanceUnit, formatDistance } from "@/lib/distance";
import { formatMoney } from "@/lib/money";
import { useUrlFilters } from "@/lib/use-url-filters";

import {
  approveExpense,
  CATEGORIES,
  CATEGORY_LABELS,
  COSTS_KEY,
  type Expense,
  EXPENSE_STATUSES,
  type ExpenseStatus,
  fetchExpenses,
  fetchFuel,
  fetchSummary,
  type FuelEntry,
  PAGE_SIZE,
  rejectExpense,
  STATUS_LABELS,
  UNIT_LABELS,
  voidExpense,
  voidFuel,
} from "./api";
import { ReceiptLink } from "./receipt";

const STATUS_STYLES: Record<ExpenseStatus, Status> = {
  submitted: "warning",
  approved: "success",
  rejected: "error",
};

type Filters = {
  start: string;
  end: string;
  status: string;
  category: string;
  fuelPage: number;
  expensePage: number;
};

function readFilters(params: URLSearchParams): Filters {
  return {
    start: params.get("start") ?? "",
    end: params.get("end") ?? "",
    status: params.get("status") ?? "",
    category: params.get("category") ?? "",
    fuelPage: Math.max(1, Number(params.get("fuelPage")) || 1),
    expensePage: Math.max(1, Number(params.get("expensePage")) || 1),
  };
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      Page {page} of {pages}
      <Button variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}

function Summary({ filters, onChange }: { filters: Filters; onChange: (changes: Partial<Filters>) => void }) {
  const summary = useQuery({
    queryKey: [...COSTS_KEY, "summary", filters.start, filters.end],
    queryFn: () => fetchSummary(filters.start, filters.end),
  });
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-semibold">Costs</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            From
            <TextInput type="date" value={filters.start} onChange={(event) => onChange({ start: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            To
            <TextInput type="date" value={filters.end} onChange={(event) => onChange({ end: event.target.value })} />
          </label>
        </div>
      </div>
      {summary.isPending && <p role="status" className="text-sm opacity-75">Loading costs…</p>}
      {summary.isError && <Alert variant="error">{summary.error.message}</Alert>}
      {summary.data && (
        <Card>
          <p className="text-xs opacity-75">
            {format(parseISO(summary.data.start), "d MMM yyyy")} to{" "}
            {format(parseISO(summary.data.end), "d MMM yyyy")}. Approved expenses only. Currencies are
            shown separately and never converted.
          </p>
          {summary.data.totals.length === 0 ? (
            <p className="mt-3 text-sm">No costs recorded in this period.</p>
          ) : (
            <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {summary.data.totals.flatMap((line) =>
                (
                  [
                    ["Fuel", line.fuel],
                    ["Maintenance", line.maintenance],
                    ["Expenses", line.expenses],
                    ["Total", line.total],
                  ] as const
                ).map(([label, amount]) => (
                  <div key={`${line.currency}-${label}`}>
                    <dt className="text-sm opacity-75">
                      {label} ({line.currency})
                    </dt>
                    <dd className="text-xl font-bold tabular-nums">{formatMoney(amount, line.currency)}</dd>
                  </div>
                )),
              )}
            </dl>
          )}
          {summary.data.awaiting_approval > 0 && (
            <p className="mt-3 text-sm">
              {summary.data.awaiting_approval}{" "}
              {summary.data.awaiting_approval === 1 ? "expense is" : "expenses are"} awaiting approval
              and not counted above.
            </p>
          )}
        </Card>
      )}
    </section>
  );
}

function FuelRow({ entry, unit, canReview, canEdit }: { entry: FuelEntry; unit: DistanceUnit; canReview: boolean; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const voidEntry = useMutation({
    mutationFn: () => voidFuel(entry.id),
    onSuccess: async () => {
      setConfirm(false);
      toast.success("Fuel record voided.");
      await queryClient.invalidateQueries({ queryKey: COSTS_KEY });
    },
    onError: (error) => {
      setConfirm(false);
      toast.error(error.message);
    },
  });
  return (
    <li className="flex flex-col gap-1 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {entry.vehicle_registration} · {Number(entry.quantity)} {UNIT_LABELS[entry.unit]}
        </span>
        <span className="font-semibold tabular-nums">{formatMoney(entry.total_cost, entry.currency)}</span>
      </div>
      <p className="text-xs opacity-75">
        {format(new Date(entry.filled_at), "d MMM yyyy, HH:mm")}
        {entry.station_name && ` · ${entry.station_name}`}
        {entry.odometer_km !== null && ` · ${formatDistance(Number(entry.odometer_km), unit)}`}
        {entry.is_full_tank && " · Full"}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {entry.receipt && <ReceiptLink file={entry.receipt} />}
        {canEdit && (
          <Link href={`/costs/fuel/${entry.id}/edit`} className="link" aria-label={`Edit fuel record for ${entry.vehicle_registration}`}>
            Edit
          </Link>
        )}
        {canReview && (
          <button type="button" className="link" onClick={() => setConfirm(true)}>
            Void
          </button>
        )}
      </div>
      {canReview && (
        <ConfirmDialog
          open={confirm}
          title="Void this fuel record?"
          confirmLabel="Void"
          busy={voidEntry.isPending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => voidEntry.mutate()}
        >
          It stops counting towards costs. The record is kept for the audit trail.
        </ConfirmDialog>
      )}
    </li>
  );
}

function ExpenseRow({ expense, userId, canReview, isOwner }: { expense: Expense; userId?: string; canReview: boolean; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<"reject" | "void" | null>(null);
  const [note, setNote] = useState("");
  const mine = expense.submitted_by_user_id === userId;
  const change = useMutation({
    mutationFn: ({ action }: { action: () => Promise<Expense>; message: string }) => action(),
    onSuccess: async (_expense, { message }) => {
      setDialog(null);
      toast.success(message);
      await queryClient.invalidateQueries({ queryKey: COSTS_KEY });
    },
    onError: (error) => {
      setDialog(null);
      toast.error(error.message);
    },
  });
  const canDecide = canReview && expense.status === "submitted" && (!mine || isOwner);
  const canEdit = expense.status !== "approved" && (canReview || mine);
  return (
    <li className="flex flex-col gap-1 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {expense.vehicle_registration} · {CATEGORY_LABELS[expense.category]}
        </span>
        <span className="flex items-center gap-2">
          <StatusBadge status={STATUS_STYLES[expense.status]}>{STATUS_LABELS[expense.status]}</StatusBadge>
          <span className="font-semibold tabular-nums">{formatMoney(expense.amount, expense.currency)}</span>
        </span>
      </div>
      <p className="text-xs opacity-75">
        {format(parseISO(expense.incurred_on), "d MMM yyyy")}
        {expense.vendor && ` · ${expense.vendor}`}
        {expense.description && ` · ${expense.description}`}
      </p>
      {expense.review_note && <p className="text-xs">Reviewer&apos;s note: {expense.review_note}</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {expense.receipt && <ReceiptLink file={expense.receipt} />}
        {canEdit && (
          <Link href={`/costs/expenses/${expense.id}/edit`} className="link" aria-label={`Edit ${CATEGORY_LABELS[expense.category]} expense`}>
            Edit
          </Link>
        )}
        {canReview && (
          <button type="button" className="link" onClick={() => setDialog("void")}>
            Void
          </button>
        )}
      </div>
      {canDecide && (
        <div className="mt-1 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={change.isPending}
            onClick={() =>
              change.mutate({ action: () => approveExpense(expense.id), message: "Expense approved." })
            }
          >
            Approve
          </Button>
          <Button variant="ghost" onClick={() => setDialog("reject")}>
            Reject
          </Button>
        </div>
      )}
      {canReview && (
        <ConfirmDialog
          open={dialog === "reject"}
          title="Reject this expense?"
          confirmLabel="Reject"
          busy={change.isPending || !note.trim()}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            change.mutate({ action: () => rejectExpense(expense.id, note), message: "Expense rejected." })
          }
        >
          <Field id={`reject-${expense.id}`} label="Reason" required>
            {(describedBy) => (
              <TextInput
                id={`reject-${expense.id}`}
                value={note}
                aria-describedby={describedBy}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        </ConfirmDialog>
      )}
      {canReview && (
        <ConfirmDialog
          open={dialog === "void"}
          title="Void this expense?"
          confirmLabel="Void"
          busy={change.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            change.mutate({ action: () => voidExpense(expense.id), message: "Expense voided." })
          }
        >
          It stops counting towards costs. The record is kept for the audit trail.
        </ConfirmDialog>
      )}
    </li>
  );
}

export function CostsOverview({ membership }: { membership: CurrentMembership }) {
  const [filters, commitFilters] = useUrlFilters(readFilters);
  const user = useCurrentUser();
  const seesAll = membership.permissions.includes("costs.view");
  const canReview = membership.permissions.includes("costs.approve");
  const unit = membership.organisation.distance_unit;
  const userId = user.data?.id;
  const fuel = useQuery({
    queryKey: [...COSTS_KEY, "fuel-list", filters.fuelPage],
    queryFn: () => fetchFuel(filters.fuelPage),
    placeholderData: keepPreviousData,
  });
  const expenses = useQuery({
    queryKey: [...COSTS_KEY, "expense-list", filters.status, filters.category, filters.expensePage],
    queryFn: () =>
      fetchExpenses({ status: filters.status, category: filters.category, page: filters.expensePage }),
    placeholderData: keepPreviousData,
  });

  function setFilters(changes: Partial<Filters>) {
    const next = { ...filters, ...changes };
    const params = new URLSearchParams();
    if (next.start) params.set("start", next.start);
    if (next.end) params.set("end", next.end);
    if (next.status) params.set("status", next.status);
    if (next.category) params.set("category", next.category);
    if (next.fuelPage > 1) params.set("fuelPage", String(next.fuelPage));
    if (next.expensePage > 1) params.set("expensePage", String(next.expensePage));
    commitFilters(next, params.toString());
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">
          {seesAll ? "Fuel and expenses" : "My fuel and expenses"}
        </h1>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/costs/fuel/new" variant="outline">
            <Plus aria-hidden className="size-4" />
            Add fuel
          </ButtonLink>
          <ButtonLink href="/costs/expenses/new">
            <Plus aria-hidden className="size-4" />
            Add expense
          </ButtonLink>
        </div>
      </div>
      {seesAll && <Summary filters={filters} onChange={setFilters} />}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-semibold">Expenses</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Status
              <SelectInput
                value={filters.status}
                onChange={(event) => setFilters({ status: event.target.value, expensePage: 1 })}
              >
                <option value="">All</option>
                {EXPENSE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </SelectInput>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Category
              <SelectInput
                value={filters.category}
                onChange={(event) => setFilters({ category: event.target.value, expensePage: 1 })}
              >
                <option value="">All</option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </option>
                ))}
              </SelectInput>
            </label>
          </div>
        </div>
        {expenses.isPending && <p role="status" className="text-sm opacity-75">Loading expenses…</p>}
        {expenses.isError && <Alert variant="error">{expenses.error.message}</Alert>}
        {expenses.data?.total === 0 &&
          (filters.status || filters.category ? (
            <p className="text-sm">No expenses match these filters.</p>
          ) : (
            <EmptyState icon={Receipt} title="No expenses yet">
              Tolls, parking, repairs and other vehicle costs appear here once submitted.
            </EmptyState>
          ))}
        {expenses.data && expenses.data.total > 0 && (
          <>
            <Card className="overflow-hidden p-0">
              <ul aria-label="Expenses" className="divide-y divide-base-300">
                {expenses.data.items.map((expense) => (
                  <ExpenseRow
                    key={expense.id}
                    expense={expense}
                    userId={userId}
                    canReview={canReview}
                    isOwner={membership.role === "owner"}
                  />
                ))}
              </ul>
            </Card>
            <Pager
              page={filters.expensePage}
              total={expenses.data.total}
              onPage={(page) => setFilters({ expensePage: page })}
            />
          </>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Fuel</h2>
        {fuel.isPending && <p role="status" className="text-sm opacity-75">Loading fuel records…</p>}
        {fuel.isError && <Alert variant="error">{fuel.error.message}</Alert>}
        {fuel.data?.total === 0 && (
          <EmptyState icon={Fuel} title="No fuel records yet">
            Record fill-ups and charging to track fuel costs and consumption.
          </EmptyState>
        )}
        {fuel.data && fuel.data.total > 0 && (
          <>
            <Card className="overflow-hidden p-0">
              <ul aria-label="Fuel records" className="divide-y divide-base-300">
                {fuel.data.items.map((entry) => (
                  <FuelRow
                    key={entry.id}
                    entry={entry}
                    unit={unit}
                    canReview={canReview}
                    canEdit={canReview || entry.created_by_user_id === userId}
                  />
                ))}
              </ul>
            </Card>
            <Pager
              page={filters.fuelPage}
              total={fuel.data.total}
              onPage={(page) => setFilters({ fuelPage: page })}
            />
          </>
        )}
      </section>
    </div>
  );
}
