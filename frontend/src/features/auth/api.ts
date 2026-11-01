import { api, ApiError } from "@/lib/api/client";

export type AuthUser = { id: string; email: string; full_name: string; is_platform_admin?: boolean };
export type AuthResponse = { user: AuthUser; csrf_token: string };
export type UserSession = {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_active_at: string;
  expires_at: string;
  is_current: boolean;
};

export const CURRENT_USER_KEY = ["auth", "me"];
export const SESSIONS_KEY = ["auth", "sessions"];

const publicPost = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body, auth: false });

export const login = (body: { email: string; password: string }) =>
  publicPost<AuthResponse>("/auth/login", body);
export const registerAccount = (body: { full_name: string; email: string; password: string }) =>
  publicPost("/auth/register", body);
export const verifyEmail = (body: { token: string; password: string }) =>
  publicPost("/auth/verify-email", body);
export const resendVerification = (email: string) =>
  publicPost("/auth/resend-verification", { email });
export const forgotPassword = (email: string) => publicPost("/auth/forgot-password", { email });
export const resetPassword = (body: { token: string; new_password: string }) =>
  publicPost("/auth/reset-password", body);

/** Resolves to null when signed out, so that isn't treated as an error. */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    return (await api<AuthResponse>("/auth/me")).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export const fetchSessions = () => api<UserSession[]>("/auth/sessions");
export const revokeSession = (id: string) => api(`/auth/sessions/${id}`, { method: "DELETE" });
export const logout = () => api("/auth/logout", { method: "POST" });
export const logoutAll = () => api("/auth/logout-all", { method: "POST" });
export const changePassword = (body: { current_password: string; new_password: string }) =>
  api("/auth/change-password", { method: "POST", body });
export const acceptInvitation = (token: string) =>
  api<{ name: string }>("/invitations/accept", { method: "POST", body: { token } });
