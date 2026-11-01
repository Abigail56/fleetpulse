import type { Metadata } from "next";
import Link from "next/link";

import {
  BulletList,
  ContactLine,
  LegalPage,
  LegalSection,
  OPERATOR,
} from "@/features/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What personal data FleetPulse handles, including driver and vehicle location data, why, and the choices people have.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      summary="What personal data FleetPulse handles, why we handle it, who it's shared with, and the rights you have over it."
    >
      <LegalSection title="1. Who is responsible for your data">
        <p>
          FleetPulse is provided by {OPERATOR} (&quot;we&quot;). Who decides how your data is used
          depends on the data:
        </p>
        <BulletList
          items={[
            <>
              <strong>Website visitors and account holders:</strong> we are responsible for contact
              messages, account details and security records.
            </>,
            <>
              <strong>Fleet records:</strong> each organisation using FleetPulse decides what it
              records about its vehicles and drivers, including location history. The organisation
              is responsible for that data, and we handle it on its behalf and on its instructions.
              If you drive for an organisation that uses FleetPulse, please send questions about
              your data to that organisation first.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="2. What we collect">
        <BulletList
          items={[
            <>
              <strong>Account details:</strong> your name, email address and a one-way hash of your
              password. We never store the password itself.
            </>,
            <>
              <strong>Google sign-in, if you use it:</strong> your name, email address and Google
              account identifier.
            </>,
            <>
              <strong>Organisation details:</strong> name, country, currency, time zone, members,
              their roles and invitations.
            </>,
            <>
              <strong>Driver records entered by an organisation:</strong> name, phone, email,
              licence number, class, country and expiry date, availability and vehicle assignments.
            </>,
            <>
              <strong>Vehicle and location data:</strong> vehicle details and, from tracking devices
              or feeds, time-stamped position, speed, heading, ignition and signal status. Once a
              driver is assigned to a vehicle, this can reveal where that person was and when.
              Geofence entries, exits and speed alerts are built from the same data.
            </>,
            <>
              <strong>Security records:</strong> active sessions and an audit log of important
              actions. IP addresses are used in hashed form for temporary rate limits, and aren&apos;t
              stored on sessions or audit records.
            </>,
            <>
              <strong>Costs and files:</strong> fuel records, expenses, receipts, inspections, defects and
              documents such as insurance, licences and medical certificates. Files are kept in private
              storage and reached only through short-lived links.
            </>,
            <>
              <strong>Contact form messages:</strong> your name, email address, company, fleet size
              and message.
            </>,
            <>
              <strong>Payment details:</strong> card details are entered on our payment provider&apos;s
              own page, and never reach FleetPulse. We keep the amount, date, status and reference of each
              payment. Online payment isn&apos;t live yet.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Why we use it">
        <BulletList
          items={[
            "To provide the service you or your organisation signed up for, including sign-in, fleet records and live tracking (performing a contract).",
            "To keep the service secure, prevent abuse and investigate problems (our legitimate interest in running a safe service).",
            "To send emails the service needs, such as verification, password reset and invitations, and to reply to your messages.",
            "To meet legal obligations that apply to us.",
          ]}
        />
        <p>
          We don&apos;t sell personal data, show advertising, or use it for advertising profiles. Each
          organisation must have its own lawful basis for tracking its vehicles and drivers, and must
          tell its drivers about it.
        </p>
      </LegalSection>

      <LegalSection title="4. Cookies and browser storage">
        <p>We use only cookies needed for signing in. There are no analytics or advertising cookies.</p>
        <BulletList
          items={[
            <>
              <code>fleetpulse_access</code>: proves you&apos;re signed in. Lasts 15 minutes.
            </>,
            <>
              <code>fleetpulse_refresh</code>: keeps you signed in. Lasts up to 14 days between uses,
              and at most 90 days from sign-in.
            </>,
            "A short-lived cookie that protects the Google sign-in step, if you use it.",
          ]}
        />
      </LegalSection>

      <LegalSection title="5. Who we share it with">
        <BulletList
          items={[
            "Members of your organisation, according to their role.",
            "Service providers that host the service, store its files or deliver its email, only as needed to do so.",
            "Google, if you choose to sign in with it.",
            "Our payment provider, when you pay online: your email address and the payment amount.",
            "Our map provider, OpenFreeMap: your browser requests map images from it, which shows it your IP address and the map area being viewed. Vehicle records aren't sent to it.",
            "Authorities or others where the law requires it, or where needed to protect people's safety or legal rights.",
          ]}
        />
        <p>
          If these providers process data in another country, we&apos;ll use the safeguards the
          applicable law requires for that transfer.
        </p>
      </LegalSection>

      <LegalSection title="6. How long we keep it">
        <BulletList
          items={[
            "Location history: 13 months by default, then deleted automatically.",
            "Account and fleet records: while the account or organisation is active. Archived vehicles and drivers are kept so that history stays accurate, until deletion is requested.",
            "Rate-limit records: minutes to hours, then they expire.",
            "Contact messages: as long as needed to deal with the enquiry and any follow-up.",
            "Audit logs: kept as a security record. We'll publish a fixed period before launch.",
          ]}
        />
      </LegalSection>

      <LegalSection title="7. How we protect it">
        <p>
          Passwords are hashed with Argon2id, each organisation&apos;s records are separated in both
          the application and the database, access depends on role, and you can review and revoke your
          sessions. Your data travels over encrypted connections in production. No system is completely
          secure. If a breach affects your data, we&apos;ll notify you and the authorities where the
          law requires it.
        </p>
      </LegalSection>

      <LegalSection title="8. Your rights">
        <p>
          Depending on where you live, you may have the right to access, correct, delete or move your
          data, to object to or restrict its use, and to withdraw consent where we rely on it. You can
          update some account details and manage sessions under{" "}
          <Link className="link" href="/account">
            Account security
          </Link>
          . For anything else, including deleting your account or exporting data, contact us using the
          details below, as these aren&apos;t yet self-service. We may need to confirm your identity,
          and we may direct requests about fleet records to the organisation responsible for them.
        </p>
        <p>You can also complain to your local data protection authority.</p>
      </LegalSection>

      <LegalSection title="9. Children">
        <p>FleetPulse is a business service, and isn&apos;t intended for anyone under 18.</p>
      </LegalSection>

      <LegalSection title="10. Changes to this policy">
        <p>
          We&apos;ll update the date above when this policy changes, and tell account holders about
          significant changes before they take effect.
        </p>
      </LegalSection>

      <LegalSection title="11. Contact">
        <p>
          For privacy questions or requests, contact us through <ContactLine />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
