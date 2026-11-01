"use client";

import { NewRule } from "@/features/automation/rule-form";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function NewRulePage() {
  return (
    <RequireOrganisation permission="automation.manage">{() => <NewRule />}</RequireOrganisation>
  );
}
