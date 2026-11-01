import { ChangePasswordForm } from "@/features/auth/change-password-form";
import { SessionList } from "@/features/auth/session-list";

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Account security</h1>
      <SessionList />
      <ChangePasswordForm />
    </div>
  );
}
