"use client";

import { Card } from "@/components/ui/card";
import { Invitations } from "@/features/organisation/invitations";
import { MembersTable } from "@/features/organisation/members-table";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function MembersPage() {
  return (
    <RequireOrganisation permission="members.view">
      {(membership) => (
        <div className="flex flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight">Members</h1>
          <Card>
            <h2 className="mb-3 text-lg font-semibold">People in this organisation</h2>
            <MembersTable membership={membership} />
          </Card>
          {membership.permissions.includes("members.manage") && (
            <Card>
              <h2 className="mb-3 text-lg font-semibold">Invite someone</h2>
              <Invitations membership={membership} />
            </Card>
          )}
        </div>
      )}
    </RequireOrganisation>
  );
}
