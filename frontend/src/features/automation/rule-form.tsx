"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectInput, TextInput } from "@/components/ui/field";
import { ALERT_TYPES, type AlertType, SEVERITIES, SEVERITY_LABELS, type Severity, TYPE_LABELS } from "@/features/alerts/api";
import { ApiError } from "@/lib/api/client";

import {
  AUTOMATION_KEY,
  createRule,
  fetchRule,
  NOTIFY_ROLES,
  type NotifyRole,
  ROLE_LABELS,
  type Rule,
  type RuleAction,
  updateRule,
} from "./api";

/** Only the listed triggers, conditions and actions exist. Nothing here can run code. */
function RuleForm({ rule }: { rule?: Rule }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const notify = rule?.actions.find((item) => item.type === "notify");
  const workOrder = rule?.actions.find((item) => item.type === "create_work_order");
  const [name, setName] = useState(rule?.name ?? "");
  const [types, setTypes] = useState<AlertType[]>(rule?.alert_types ?? []);
  const [severity, setSeverity] = useState<Severity>(rule?.min_severity ?? "info");
  const [roles, setRoles] = useState<NotifyRole[]>(notify?.type === "notify" ? notify.roles : []);
  const [email, setEmail] = useState(notify?.type === "notify" ? notify.email : false);
  const [makeWork, setMakeWork] = useState(Boolean(workOrder));
  const [workTitle, setWorkTitle] = useState(
    workOrder?.type === "create_work_order" ? (workOrder.title ?? "") : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle<T>(list: T[], item: T) {
    return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Please give the rule a name.");
    if (types.length === 0) return setError("Choose at least one type of alert.");
    if (roles.length === 0 && !makeWork) return setError("Choose at least one thing to do.");
    const onlyLicence = types.every((type) => type === "licence_expiry");
    if (makeWork && onlyLicence) {
      return setError("A work order needs an alert about a vehicle, and licence alerts are about a driver.");
    }
    const actions: RuleAction[] = [
      ...(roles.length > 0 ? [{ type: "notify" as const, roles, email }] : []),
      ...(makeWork ? [{ type: "create_work_order" as const, title: workTitle.trim() || null }] : []),
    ];
    setError(null);
    setBusy(true);
    try {
      const body = { name: name.trim(), alert_types: types, min_severity: severity, actions };
      if (rule) await updateRule(rule.id, body);
      else await createRule(body);
      await queryClient.invalidateQueries({ queryKey: AUTOMATION_KEY });
      toast.success(rule ? "Rule updated." : "Rule created.");
      router.push("/automation");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The rule couldn't be saved.");
      setBusy(false);
    }
  }

  return (
    <Card>
      <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-6">
        {error && <Alert variant="error">{error}</Alert>}
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Name
          <TextInput maxLength={120} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">When an alert is raised for</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ALERT_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={types.includes(type)}
                  onChange={() => setTypes(toggle(types, type))}
                />
                {TYPE_LABELS[type]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          And its severity is at least
          <SelectInput value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}>
            {[...SEVERITIES].reverse().map((level) => (
              <option key={level} value={level}>
                {SEVERITY_LABELS[level]}
              </option>
            ))}
          </SelectInput>
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Then notify</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {NOTIFY_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={roles.includes(role)}
                  onChange={() => setRoles(toggle(roles, role))}
                />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </div>
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={email}
              disabled={roles.length === 0}
              onChange={(event) => setEmail(event.target.checked)}
            />
            Email them too, whatever their own preferences say
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">And</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={makeWork}
              onChange={(event) => setMakeWork(event.target.checked)}
            />
            Create a work order for the vehicle
          </label>
          {makeWork && (
            <label className="flex flex-col gap-1.5 text-sm">
              Work order title (optional)
              <TextInput maxLength={120} value={workTitle} onChange={(event) => setWorkTitle(event.target.value)} />
            </label>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : rule ? "Save changes" : "Create rule"}
          </Button>
          <Link href="/automation" className="btn btn-ghost font-medium">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}

export function NewRule() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">New rule</h1>
      <RuleForm />
    </div>
  );
}

export function EditRule() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: [...AUTOMATION_KEY, "rule", id], queryFn: () => fetchRule(id) });
  if (query.isPending) return <p role="status" className="text-sm opacity-75">Loading rule…</p>;
  if (!query.data || query.data.archived_at) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Rule</h1>
        <Alert variant="error">
          {query.data
            ? "An archived rule can't be changed."
            : missing
              ? "This rule wasn't found."
              : query.error?.message}
        </Alert>
        <ButtonLink href="/automation" variant="outline">
          Back to automation
        </ButtonLink>
      </div>
    );
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Edit rule</h1>
      <RuleForm rule={query.data} />
    </div>
  );
}
