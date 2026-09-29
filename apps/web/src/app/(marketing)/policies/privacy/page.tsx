import type { Metadata } from "next";
import Link from "next/link";

import { PolicyPage } from "@/components/marketing/policies/PolicyPage";
import {
  SITE_URL,
  SUPPORT_EMAIL,
} from "@/components/marketing/policies/policy-links";

export const metadata: Metadata = {
  title: "Privacy Policy | MultiFeed",
  description:
    "How MultiFeed collects, uses, stores, and shares personal and social-platform data.",
  alternates: { canonical: "/policies/privacy" },
  openGraph: {
    title: "Privacy Policy | MultiFeed",
    description: "How MultiFeed handles personal and social-platform data.",
    url: "/policies/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <PolicyPage
      description="This policy explains what information MultiFeed handles, why we use it, and the choices available to you when you use our website and social media management service."
      title="Privacy Policy"
    >
      <section>
        <h2>1. Scope and who we are</h2>
        <p>
          This Privacy Policy applies to MultiFeed at{" "}
          <a href={SITE_URL}>{SITE_URL}</a>, including its dashboard, account
          connections, scheduling, publishing, analytics, inbox, billing, and
          support features. In this policy, “MultiFeed,” “we,” “us,” and “our”
          refer to the operator of the MultiFeed service.
        </p>
      </section>

      <section>
        <h2>2. Information we collect</h2>
        <h3>Information you provide</h3>
        <ul>
          <li>
            account and workspace information, including your name, email
            address, authentication details, organization name, and team
            membership;
          </li>
          <li>
            posts, captions, media, schedules, notes, publishing preferences,
            and support messages;
          </li>
          <li>
            subscription and transaction information. Our payment provider
            processes payment-card details; MultiFeed receives records such as
            customer, subscription, product, payment status, and transaction
            identifiers; and
          </li>
          <li>
            information you send when you contact us or request support or data
            deletion.
          </li>
        </ul>

        <h3>Information collected automatically</h3>
        <p>
          We may collect device, browser, IP address, log, diagnostic, security,
          and product-usage information needed to operate, protect, and improve
          the service. We may also use essential cookies and similar storage for
          authentication, session continuity, preferences, and security.
        </p>
        <h3>Optional website analytics</h3>
        <p>
          If you choose “Allow analytics,” we use Google Analytics to measure
          visits to our public website, including pages viewed, browser and
          device information, and referral sources. We do not load Google
          Analytics before you opt in, and we do not use it on sign-in pages or
          within your dashboard. We do not send your email address, sign-in
          codes, social posts, or URL query strings to Google Analytics.
          Advertising personalization and Google signals are disabled.
        </p>
        <p>
          You can decline analytics without losing access to MultiFeed. You can
          change your choice using “Cookie preferences” at the bottom of any
          public website page. We remember that choice for up to six months;
          declining after accepting removes our analytics cookies. Google
          processes analytics data on our behalf and may process it outside your
          country. See{" "}
          <a href="https://policies.google.com/privacy">
            Google’s privacy policy
          </a>{" "}
          for more information.
        </p>
      </section>

      <section>
        <h2>3. Data from connected social platforms</h2>
        <p>
          MultiFeed accesses platform data only after you choose to connect an
          account and approve the permissions shown by that platform. Depending
          on the service and permissions you approve, we may access:
        </p>
        <ul>
          <li>
            account, profile, Page, channel, or organization identifiers,
            usernames, display names, profile images, and—in the case of
            LinkedIn—the email address returned through OpenID Connect;
          </li>
          <li>
            OAuth access tokens, refresh tokens, token expiration dates, and the
            permissions you granted;
          </li>
          <li>
            content and media needed to create, upload, schedule, or publish a
            post at your direction;
          </li>
          <li>
            post, channel, engagement, comment, message, and analytics data when
            a connected feature requires it; and
          </li>
          <li>
            publishing status, platform post identifiers, errors, and delivery
            links.
          </li>
        </ul>
        <p>
          These connections may include Facebook, Instagram, Threads, LinkedIn,
          TikTok, YouTube and Google APIs, and X. MultiFeed does not receive or
          store the password you use to sign in to a social platform.
        </p>
      </section>

      <section>
        <h2>4. How we use information</h2>
        <ul>
          <li>create and secure your account and workspace;</li>
          <li>
            connect the accounts you select and maintain those connections;
          </li>
          <li>
            draft, store, schedule, publish, and report on content according to
            your instructions;
          </li>
          <li>
            display account information, content calendars, publishing results,
            inbox items, and analytics to authorized workspace members;
          </li>
          <li>provide support and service communications;</li>
          <li>manage subscriptions and billing records;</li>
          <li>
            detect abuse, protect the service, troubleshoot errors, and improve
            reliability; and
          </li>
          <li>comply with law and enforce our Terms of Service.</li>
        </ul>
        <p>
          We do not use connected-account data to serve targeted advertising,
          build advertising profiles, determine creditworthiness, or sell
          personal information.
        </p>
      </section>

      <section>
        <h2>5. Google user data and Limited Use</h2>
        <p>
          MultiFeed uses Google user data only to provide or improve the
          user-facing features you request, such as connecting a YouTube
          channel, uploading videos, reading channel information, and displaying
          YouTube analytics. MultiFeed&apos;s use and transfer to any other app
          of information received from Google APIs will adhere to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements.
        </p>
        <p>
          People do not read Google user data unless you give affirmative
          permission for a specific support purpose, access is necessary for
          security or abuse investigation, we must comply with law, or the data
          has been aggregated and anonymized for internal operations.
        </p>
      </section>

      <section>
        <h2>6. When we share information</h2>
        <p>We may share information only as needed with:</p>
        <ul>
          <li>
            infrastructure, authentication, database, storage, monitoring,
            support, and payment providers acting on our behalf;
          </li>
          <li>
            social platforms when you connect an account or direct us to access
            or publish content;
          </li>
          <li>
            other authorized members of your MultiFeed workspace, based on the
            collaborative nature of the service;
          </li>
          <li>
            authorities or other parties when reasonably necessary to comply
            with law, protect rights and safety, investigate abuse, or enforce
            agreements; and
          </li>
          <li>
            a successor in a merger, financing, acquisition, reorganization, or
            sale of assets, subject to appropriate confidentiality protections.
          </li>
        </ul>
        <p>We do not sell or rent personal or connected-platform data.</p>
      </section>

      <section>
        <h2>7. Legal bases</h2>
        <p>
          Where applicable law requires a legal basis, we process information to
          perform our contract with you, with your consent, for our legitimate
          interests in operating and securing MultiFeed, and to comply with
          legal obligations. You may withdraw consent for future processing at
          any time, including by disconnecting an integration.
        </p>
      </section>

      <section>
        <h2>8. Retention and deletion</h2>
        <p>
          We keep information only as long as reasonably necessary to provide
          the service and meet security, dispute-resolution, accounting, and
          legal obligations. OAuth credentials and the related connected-account
          record are deleted from MultiFeed when you disconnect that account.
          Some billing, security, and transaction records may be kept where law
          requires it or for legitimate fraud-prevention and recordkeeping
          needs.
        </p>
        <p>
          To remove an integration or request deletion of your full MultiFeed
          account and personal data, follow our{" "}
          <Link href="/policies/data-deletion">Data Deletion Instructions</Link>
          . Deleting data from MultiFeed does not automatically delete a post
          that has already been published on a third-party platform.
        </p>
      </section>

      <section>
        <h2>9. Security</h2>
        <p>
          We use reasonable technical and organizational safeguards. Connected
          account tokens are encrypted at rest, access is limited, and data is
          transmitted over secure connections. No online service can guarantee
          absolute security, so please protect your credentials and notify us if
          you suspect unauthorized access.
        </p>
      </section>

      <section>
        <h2>10. International processing</h2>
        <p>
          MultiFeed and its service providers may process information in
          countries other than your own. Where required, we use appropriate
          safeguards for international transfers of personal information.
        </p>
      </section>

      <section>
        <h2>11. Your rights and choices</h2>
        <p>
          Depending on where you live, you may have rights to access, correct,
          export, delete, restrict, or object to the processing of your personal
          information, and to appeal or complain to a data-protection authority.
          You can disconnect social accounts in MultiFeed and revoke access in
          the relevant platform&apos;s security settings. We may verify your
          identity before completing a request.
        </p>
      </section>

      <section>
        <h2>12. Children</h2>
        <p>
          MultiFeed is intended for people who are at least 18 years old. We do
          not knowingly collect personal information from children. Contact us
          if you believe a child has provided information to the service.
        </p>
      </section>

      <section>
        <h2>13. Changes to this policy</h2>
        <p>
          We may update this policy as MultiFeed changes. We will post the new
          version here, change the effective date, and provide additional notice
          when required by law or when a change materially affects how we use
          previously collected data.
        </p>
      </section>

      <section>
        <h2>14. Contact us</h2>
        <p>
          For privacy questions or requests, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Please
          include “Privacy Request” in the subject line.
        </p>
      </section>
    </PolicyPage>
  );
}
