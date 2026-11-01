import type { Metadata } from "next";
import Link from "next/link";

import {
  BulletList,
  ContactLine,
  GOVERNING_LAW,
  LegalPage,
  LegalSection,
  OPERATOR,
} from "@/features/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms and Conditions",
  description: "The terms that apply when you or your organisation use FleetPulse.",
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms and Conditions"
      summary="The agreement between you and FleetPulse when you use the website or the service. Please read it before creating an account."
    >
      <LegalSection title="1. Agreement to these terms">
        <p>
          These terms are between you and {OPERATOR} (&quot;we&quot;). By creating an account or using
          FleetPulse, you agree to them. If you use FleetPulse for an organisation, you confirm that
          you have authority to bind that organisation, and &quot;you&quot; includes it. If you
          don&apos;t agree, please don&apos;t use the service.
        </p>
      </LegalSection>

      <LegalSection title="2. The service">
        <p>
          FleetPulse is software for managing vehicles, drivers and vehicle tracking. It&apos;s under
          active development, so features may be added, changed or withdrawn. A separate signed
          agreement with us takes priority over these terms where they conflict.
        </p>
      </LegalSection>

      <LegalSection title="3. Accounts and security">
        <BulletList
          items={[
            "You must be at least 18 and give accurate information.",
            "Keep your password and any GPS feed keys confidential, and tell us promptly if you think they've been misused.",
            "You're responsible for what happens under your account. Organisation owners and administrators are responsible for who they invite and which roles they give them.",
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Tracking people lawfully">
        <p>
          Vehicle location data can reveal where a person is. If you use FleetPulse to track vehicles,
          you are responsible for complying with the employment, privacy and surveillance laws that
          apply to you. That includes having a lawful basis, telling drivers about the tracking and
          getting consent where required. You must not use FleetPulse to track anyone covertly or
          unlawfully.
        </p>
      </LegalSection>

      <LegalSection title="5. Acceptable use">
        <p>You must not:</p>
        <BulletList
          items={[
            "break the law, or infringe anyone's rights, through the service;",
            "try to access another organisation's data, or probe or bypass security, without our written permission;",
            "upload malicious code, overload the service, or interfere with its operation;",
            "send false position data and present it as real;",
            "resell the service, or copy it to build a competing product, without our written permission.",
          ]}
        />
      </LegalSection>

      <LegalSection title="6. Your data">
        <p>
          You keep ownership of the data you put into FleetPulse. You give us permission to host and
          process it only as needed to provide, secure and support the service. You&apos;re responsible
          for having the right to provide it. Our{" "}
          <Link className="link" href="/privacy">
            Privacy Policy
          </Link>{" "}
          explains how personal data is handled.
        </p>
      </LegalSection>

      <LegalSection title="7. Location data and maps have limits">
        <p>
          Positions come from third-party devices and networks, and can be late, inaccurate or
          missing. FleetPulse marks old and simulated data, but cannot guarantee a vehicle&apos;s
          actual location. Don&apos;t rely on it for emergency response or as the only safeguard for
          anyone&apos;s safety. Map backgrounds come from third parties and may be unavailable.
        </p>
      </LegalSection>

      <LegalSection title="8. Fees and billing">
        <p>
          Online payment isn&apos;t live yet, so we aren&apos;t charging anyone during development.
          The{" "}
          <Link className="link" href="/pricing">
            Pricing
          </Link>{" "}
          page shows our planned launch prices. Once paid plans begin, and only after you have chosen
          one, these terms apply:
        </p>
        <BulletList
          items={[
            "Fees are charged per active vehicle for each 30-day period, in advance, in the currency shown. They exclude taxes, which you're responsible for.",
            "Fees already paid aren't refundable, except where the law requires it or we say otherwise.",
            "We'll give at least 30 days' notice of a price increase, and it applies from your next period.",
            "If a period ends unpaid, you have 7 days of grace. After that you keep access to your data, but can't add vehicles or invite people until you pay.",
            "Each period is paid for separately and doesn't renew by itself, so you can stop at any time by not paying for the next one.",
          ]}
        />
      </LegalSection>

      <LegalSection title="9. Third-party services">
        <p>
          FleetPulse works with services we don&apos;t control, such as GPS devices and feeds, map
          providers and Google sign-in. Your use of them may be under their own terms, and we
          aren&apos;t responsible for their availability or accuracy.
        </p>
      </LegalSection>

      <LegalSection title="10. Confidentiality">
        <p>
          Each of us will keep the other&apos;s non-public information confidential, use it only for
          the purposes of this agreement, and protect it with reasonable care. This doesn&apos;t apply
          to information that is public, independently developed, or that the law requires to be
          disclosed.
        </p>
      </LegalSection>

      <LegalSection title="11. Our intellectual property">
        <p>
          We own FleetPulse, including its software and branding. We give you a limited,
          non-exclusive, non-transferable right to use it under these terms. If you send us feedback,
          we may use it without obligation to you.
        </p>
      </LegalSection>

      <LegalSection title="12. Suspension and ending the service">
        <p>
          You can stop using FleetPulse at any time, and ask us to close your account through the
          contact details below. We may suspend or close access if you seriously or repeatedly breach
          these terms, if there&apos;s a security risk, or if the law requires it. Where reasonable,
          we&apos;ll warn you first. When an organisation leaves, we&apos;ll give it a reasonable
          chance to request a copy of its data before deleting it, unless the law requires us to keep
          it.
        </p>
      </LegalSection>

      <LegalSection title="13. No guarantees">
        <p>
          To the extent the law allows, the service is provided &quot;as is&quot; and &quot;as
          available&quot;, without warranties of uninterrupted availability, accuracy or fitness for a
          particular purpose. Nothing in these terms removes rights you have that the law doesn&apos;t
          allow to be excluded.
        </p>
      </LegalSection>

      <LegalSection title="14. Limit of liability">
        <p>
          To the extent the law allows, we aren&apos;t liable for indirect or consequential losses, or
          for lost profits, revenue or data. Our total liability for any claim is limited to the fees
          you paid us in the 12 months before it arose. Nothing here limits liability for fraud, death
          or personal injury caused by negligence, or anything else that can&apos;t legally be limited.
        </p>
      </LegalSection>

      <LegalSection title="15. Your responsibility for claims">
        <p>
          If you use FleetPulse for an organisation, it will cover our reasonable losses from third-party
          claims caused by its unlawful tracking, its data, or its breach of these terms.
        </p>
      </LegalSection>

      <LegalSection title="16. Changes to these terms">
        <p>
          We may update these terms. We&apos;ll update the date above, and give account holders
          reasonable notice of significant changes. If you keep using the service after they take
          effect, the new terms apply. If you disagree, you can stop using it.
        </p>
      </LegalSection>

      <LegalSection title="17. Events outside our control">
        <p>
          We aren&apos;t responsible for delays or failures caused by events beyond our reasonable
          control, such as outages of networks or suppliers, natural disasters, or government action.
        </p>
      </LegalSection>

      <LegalSection title="18. Governing law">
        <p>
          {GOVERNING_LAW
            ? `These terms are governed by the laws of ${GOVERNING_LAW}, and its courts have jurisdiction over disputes, except where the law gives you the right to bring a claim elsewhere.`
            : "The governing law and courts for these terms will be stated here before launch."}
        </p>
      </LegalSection>

      <LegalSection title="19. General">
        <p>
          If part of these terms can&apos;t be enforced, the rest still applies. If we don&apos;t enforce
          a right straight away, we haven&apos;t given it up. You can&apos;t transfer these terms without
          our consent. We may transfer them as part of a reorganisation or sale of the business.
        </p>
      </LegalSection>

      <LegalSection title="20. Contact">
        <p>
          For questions about these terms, contact us through <ContactLine />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
