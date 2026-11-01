import { api } from "@/lib/api/client";

import type { Role } from "./roles";

export type Organisation = {
  id: string;
  name: string;
  slug: string;
  country_code: string;
  default_currency: string;
  timezone: string;
  distance_unit: "km" | "mi";
};
export type CurrentMembership = {
  organisation: Organisation;
  role: Role;
  permissions: string[];
};
export type MyOrganisation = { organisation: Organisation; role: Role; is_active: boolean };
export type Member = {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: Role;
  status: "active" | "suspended";
};
export type Invitation = {
  id: string;
  email: string;
  role: Role;
  created_at: string;
  expires_at: string;
};
export type OrganisationInput = {
  name: string;
  country_code: string;
  default_currency: string;
  timezone: string;
  distance_unit: "km" | "mi";
};

export const KEYS = {
  current: ["organisation", "current"],
  mine: ["organisation", "mine"],
  members: ["organisation", "members"],
  invitations: ["organisation", "invitations"],
};

export const fetchCurrent = () => api<CurrentMembership>("/organisation");
export const fetchMine = () => api<MyOrganisation[]>("/organisations");
export const createOrganisation = (body: OrganisationInput) =>
  api<Organisation>("/organisations", { method: "POST", body });
export const switchOrganisation = (id: string) =>
  api<Organisation>(`/organisations/${id}/switch`, { method: "POST" });
export const updateOrganisation = (body: Partial<OrganisationInput>) =>
  api<Organisation>("/organisation", { method: "PATCH", body });
export const leaveOrganisation = () => api("/organisation/leave", { method: "POST" });
export const fetchMembers = () => api<Member[]>("/organisation/members");
export const updateMember = (id: string, body: { role?: Role; status?: Member["status"] }) =>
  api<Member>(`/organisation/members/${id}`, { method: "PATCH", body });
export const removeMember = (id: string) =>
  api(`/organisation/members/${id}`, { method: "DELETE" });
export const fetchInvitations = () => api<Invitation[]>("/organisation/invitations");
export const createInvitation = (body: { email: string; role: Role }) =>
  api<Invitation>("/organisation/invitations", { method: "POST", body });
export const revokeInvitation = (id: string) =>
  api(`/organisation/invitations/${id}`, { method: "DELETE" });
