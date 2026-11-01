"use client";
"use no memo";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectInput } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { useCurrentUser } from "@/features/auth/use-current-user";

import {
  type CurrentMembership,
  fetchMembers,
  KEYS,
  type Member,
  removeMember,
  updateMember,
} from "./api";
import { grantableRoles, ROLE_LABELS, type Role } from "./roles";

type PendingAction = {
  title: string;
  body: string;
  label: string;
  run: () => void;
};

const features = tableFeatures({});
const column = createColumnHelper<typeof features, Member>();

export function MembersTable({ membership }: { membership: CurrentMembership }) {
  const queryClient = useQueryClient();
  const me = useCurrentUser();
  const members = useQuery({ queryKey: KEYS.members, queryFn: fetchMembers });
  const [pending, setPending] = useState<PendingAction | null>(null);
  const canManage = membership.permissions.includes("members.manage");
  const myRole = membership.role;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["organisation"] });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: Role; status?: Member["status"] }) =>
      updateMember(id, body),
    onSuccess: () => {
      setPending(null);
      toast.success("Member updated.");
      return refresh();
    },
    onError: (error) => {
      setPending(null);
      toast.error(error.message);
      // Puts the role select back to the value the server still holds.
      return refresh();
    },
  });
  const remove = useMutation({
    mutationFn: removeMember,
    onSuccess: () => {
      setPending(null);
      toast.success("Member removed.");
      return refresh();
    },
    onError: (error) => {
      setPending(null);
      toast.error(error.message);
    },
  });
  const busy = update.isPending || remove.isPending;

  function changeRole(member: Member, role: Role) {
    if (role !== "owner") {
      update.mutate({ id: member.id, role });
      return;
    }
    setPending({
      title: `Make ${member.full_name} an owner?`,
      body: "Owners have full control of the organisation, including over other owners.",
      label: "Make owner",
      run: () => update.mutate({ id: member.id, role }),
    });
  }

  const columns = column.columns([
    column.accessor("full_name", {
      header: "Name",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">
            {row.original.full_name}
            {row.original.user_id === me.data?.id && (
              <span className="font-normal opacity-70"> (you)</span>
            )}
          </p>
          <p className="text-sm opacity-70">{row.original.email}</p>
        </div>
      ),
    }),
    column.accessor("role", {
      header: "Role",
      cell: ({ row }) => {
        const member = row.original;
        const editable = canManage && (member.role !== "owner" || myRole === "owner");
        if (!editable) return ROLE_LABELS[member.role];
        const options = new Set<Role>([...grantableRoles(myRole), member.role]);
        return (
          <SelectInput
            aria-label={`Role for ${member.full_name}`}
            value={member.role}
            disabled={busy}
            className="min-w-44"
            onChange={(event) => changeRole(member, event.target.value as Role)}
          >
            {[...options].map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </SelectInput>
        );
      },
    }),
    column.accessor("status", {
      header: "Status",
      cell: ({ getValue }) =>
        getValue() === "active" ? (
          <StatusBadge status="success">Active</StatusBadge>
        ) : (
          <StatusBadge status="warning">Suspended</StatusBadge>
        ),
    }),
    column.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const member = row.original;
        const isMe = member.user_id === me.data?.id;
        const editable = canManage && !isMe && (member.role !== "owner" || myRole === "owner");
        if (!editable) return null;
        const suspended = member.status === "suspended";
        return (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              disabled={busy}
              aria-label={`${suspended ? "Reactivate" : "Suspend"} ${member.full_name}`}
              onClick={() =>
                suspended
                  ? update.mutate({ id: member.id, status: "active" })
                  : setPending({
                      title: `Suspend ${member.full_name}?`,
                      body: "They'll lose access straight away, until reactivated.",
                      label: "Suspend",
                      run: () => update.mutate({ id: member.id, status: "suspended" }),
                    })
              }
            >
              {suspended ? "Reactivate" : "Suspend"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              aria-label={`Remove ${member.full_name}`}
              onClick={() =>
                setPending({
                  title: `Remove ${member.full_name}?`,
                  body: "They'll lose access straight away, and would need a new invitation to return.",
                  label: "Remove",
                  run: () => remove.mutate(member.id),
                })
              }
            >
              Remove
            </Button>
          </div>
        );
      },
    }),
  ]);

  const table = useTable<typeof features, Member>({
    features,
    data: members.data ?? [],
    columns,
    getRowId: (row) => row.id,
  });

  if (members.isPending) {
    return (
      <div role="status" aria-label="Loading members" className="flex flex-col gap-2">
        <div className="skeleton h-14 w-full" />
        <div className="skeleton h-14 w-full" />
      </div>
    );
  }
  if (members.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">{members.error.message}</Alert>
        <Button variant="outline" onClick={() => members.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Scrolls by itself on small screens, and is focusable so keyboards can scroll it too. */}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Members table">
        <table className="table">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id} scope="col" className="text-base-content">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ""}
        confirmLabel={pending?.label ?? "Confirm"}
        busy={busy}
        onConfirm={() => pending?.run()}
        onCancel={() => setPending(null)}
      >
        {pending?.body}
      </ConfirmDialog>
    </>
  );
}
