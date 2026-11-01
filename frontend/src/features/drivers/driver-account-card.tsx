"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { SelectInput } from "@/components/ui/field";
import { fetchMembers } from "@/features/organisation/api";

import { type Driver, DRIVERS_KEY, linkDriverAccount } from "./api";

/** Lets a driver sign in to see and run their own trips. */
export function DriverAccountCard({ driver }: { driver: Driver }) {
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ["organisation", "members"], queryFn: fetchMembers });
  const link = useMutation({
    mutationFn: (userId: string | null) => linkDriverAccount(driver.id, userId),
    onSuccess: async () => {
      toast.success("Sign-in account updated.");
      await queryClient.invalidateQueries({ queryKey: DRIVERS_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Card>
      <h2 className="text-lg font-semibold">Sign-in account</h2>
      <p className="mt-1 text-sm opacity-75">
        The member linked here sees this driver&apos;s trips, and can start and complete them.
      </p>
      {members.isError ? (
        <p className="mt-3 text-sm">Members couldn&apos;t be loaded.</p>
      ) : (
        <label className="mt-3 flex flex-col gap-1 text-sm font-medium">
          Member
          <SelectInput
            value={driver.user_id ?? ""}
            disabled={members.isPending || link.isPending}
            onChange={(event) => link.mutate(event.target.value || null)}
          >
            <option value="">Not linked</option>
            {members.data?.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.full_name} ({member.email})
              </option>
            ))}
          </SelectInput>
        </label>
      )}
    </Card>
  );
}
