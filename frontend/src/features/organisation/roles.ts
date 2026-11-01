export const ROLES = [
  "owner",
  "administrator",
  "fleet_manager",
  "dispatcher",
  "maintenance_manager",
  "finance_manager",
  "driver",
  "read_only",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  administrator: "Administrator",
  fleet_manager: "Fleet manager",
  dispatcher: "Dispatcher",
  maintenance_manager: "Maintenance manager",
  finance_manager: "Finance manager",
  driver: "Driver",
  read_only: "Read only",
};

/** Mirrors the API's rule for a helpful UI. The API enforces it either way. */
export function grantableRoles(myRole: Role): readonly Role[] {
  return myRole === "owner" ? ROLES : ROLES.filter((role) => role !== "owner");
}
