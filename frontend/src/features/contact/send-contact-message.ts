import { z } from "zod";

export const FLEET_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(200),
  email: z.email("Please enter a valid email address."),
  company: z.string().trim().max(200),
  fleet_size: z.enum(["", ...FLEET_SIZES]),
  message: z
    .string()
    .trim()
    .min(10, "Please write at least 10 characters.")
    .max(4000, "Please keep your message under 4,000 characters."),
  website: z.string(),
});

export type ContactValues = z.infer<typeof contactSchema>;

export type SendResult = "sent" | "rate_limited" | "failed";

export async function sendContactMessage(
  values: ContactValues,
  baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL,
): Promise<SendResult> {
  if (!baseUrl) {
    console.error("contact_failed: NEXT_PUBLIC_API_BASE_URL is not set");
    return "failed";
  }
  try {
    const response = await fetch(`${baseUrl}/api/v1/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...values,
        company: values.company || null,
        fleet_size: values.fleet_size || null,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) return "sent";
    if (response.status === 429) return "rate_limited";
    console.error("contact_failed: status", response.status);
    return "failed";
  } catch (error) {
    console.error("contact_failed:", error);
    return "failed";
  }
}
