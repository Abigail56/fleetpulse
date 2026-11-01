import { z } from "zod";

const email = z.email("Please enter a valid email address.");

// Matches the API's limits. The API also rejects common passwords, and that message is shown.
const newPassword = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128, "Use 128 characters or fewer.");
const existingPassword = z.string().min(1, "Please enter your password.").max(128);

const passwordsMatch = {
  check: (values: { new_password: string; confirm_password: string }) =>
    values.new_password === values.confirm_password,
  options: { path: ["confirm_password"], message: "The passwords don't match." },
};

export const loginSchema = z.object({ email, password: existingPassword });
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  full_name: z.string().trim().min(1, "Please enter your name.").max(200),
  email,
  password: newPassword,
});
export type RegisterValues = z.infer<typeof registerSchema>;

export const emailSchema = z.object({ email });
export type EmailValues = z.infer<typeof emailSchema>;

export const verifySchema = z.object({ password: existingPassword });
export type VerifyValues = z.infer<typeof verifySchema>;

export const resetSchema = z
  .object({ new_password: newPassword, confirm_password: z.string() })
  .refine(passwordsMatch.check, passwordsMatch.options);
export type ResetValues = z.infer<typeof resetSchema>;

export const changePasswordSchema = z
  .object({
    current_password: existingPassword,
    new_password: newPassword,
    confirm_password: z.string(),
  })
  .refine(passwordsMatch.check, passwordsMatch.options);
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
