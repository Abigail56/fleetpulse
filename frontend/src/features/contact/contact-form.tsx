"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";

import {
  type ContactValues,
  contactSchema,
  FLEET_SIZES,
  type SendResult,
  sendContactMessage,
} from "./send-contact-message";

const FAILURE_MESSAGES: Record<Exclude<SendResult, "sent">, string> = {
  rate_limited: "You've sent several messages recently. Please try again later.",
  failed: "We couldn't send your message. Your text is still here, so please try again shortly.",
};

export function ContactForm() {
  const [result, setResult] = useState<SendResult | null>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      fleet_size: "",
      message: "",
      website: "",
    },
  });

  useEffect(() => {
    if (result === "sent") confirmation.current?.focus();
  }, [result]);

  if (result === "sent") {
    return (
      <div ref={confirmation} tabIndex={-1}>
        <Alert variant="success">
          <p className="font-semibold">Thanks. Your message has been sent.</p>
          <p className="mt-1">We&apos;ll reply to the email address you gave us.</p>
        </Alert>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={handleSubmit(async (values) => {
        setResult(null);
        setResult(await sendContactMessage(values));
      })}
    >
      {result && <Alert variant="error">{FAILURE_MESSAGES[result]}</Alert>}

      <Field id="name" label="Your name" required error={errors.name?.message}>
        {(describedBy) => (
          <TextInput
            id="name"
            autoComplete="name"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy}
            {...register("name")}
          />
        )}
      </Field>
      <Field id="email" label="Work email" required error={errors.email?.message}>
        {(describedBy) => (
          <TextInput
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describedBy}
            {...register("email")}
          />
        )}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="company" label="Company" error={errors.company?.message}>
          {(describedBy) => (
            <TextInput
              id="company"
              autoComplete="organization"
              aria-describedby={describedBy}
              {...register("company")}
            />
          )}
        </Field>
        <Field id="fleet_size" label="Number of vehicles">
          {() => (
            <SelectInput id="fleet_size" {...register("fleet_size")}>
              <option value="">Select</option>
              {FLEET_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      </div>
      <Field id="message" label="How can we help?" required error={errors.message?.message}>
        {(describedBy) => (
          <TextArea
            id="message"
            rows={6}
            aria-invalid={errors.message ? true : undefined}
            aria-describedby={describedBy}
            {...register("message")}
          />
        )}
      </Field>
      {/* Spam trap: hidden from people and screen readers, tempting to bots. */}
      <div aria-hidden className="absolute -left-[9999px]">
        <label htmlFor="website">Website</label>
        <input id="website" tabIndex={-1} autoComplete="off" {...register("website")} />
      </div>
      <div>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send message"}
        </Button>
      </div>
    </form>
  );
}
