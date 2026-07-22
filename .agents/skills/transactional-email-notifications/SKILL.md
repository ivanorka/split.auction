---
name: transactional-email-notifications
description: Set up, implement, style, test, and troubleshoot transactional email notifications. Use when a project needs registration, password-reset, payment, booking, order, bid, status-change, or admin emails; when configuring Resend and sending domains; or when verifying email delivery and diagnosing inbox, spam, bounce, or suppression issues.
---

# 01 · Transactional Email Notifications

Build reliable transactional email as product functionality, not as an afterthought. Use Resend by default when it fits the existing stack; preserve the project's own mail provider when it is already established.

## Workflow

1. Inspect the application's current notification paths, environment variables, deployment target, and existing mail provider.
2. Define the concrete events and recipients before adding code. Read [references/events.md](references/events.md) for the baseline event matrix.
3. Use a verified sending domain and a role-based sender such as `notifications@subdomain.example.com`. Never place API keys, passwords, or SMTP credentials in committed files, client-side code, logs, or the skill itself.
4. Keep sending server-side. Validate input, authenticate the initiating user, authorize the action, and return non-sensitive errors to the client.
5. Build emails with table-based HTML, inline styles, a text alternative, a clear preheader, and a narrow responsive layout. Reuse the product's typography, palette, and visual hierarchy; do not copy the web UI blindly into email.
6. Make sending non-blocking where the product flow permits it, but record the provider response, event type, recipient, and provider message ID for audit and troubleshooting.
7. Test with a real, explicitly authorized recipient. Confirm acceptance, then inspect provider events for `sent`, `delivered`, `bounced`, `complained`, or `suppressed`. Provider acceptance is not delivery.
8. When the product supports user-controlled notifications, expose every implemented configurable event in Settings. Persist a master email switch and event-level switches server-side, then enforce them before the message enters the outbox. Do not treat a hidden or disabled frontend control as enforcement.

## Design Standard

- Start with one clear purpose per email and an action-oriented subject.
- Put the important state near the top: amount, deadline, confirmation number, or status.
- Use a single prominent CTA with a public HTTPS destination.
- Include a small explanation of why the recipient received the email and appropriate support/contact details.
- Mark test messages visibly as tests. Keep production email copy factual and localized to the user's selected language.
- Include a plain-text alternative for every transactional message.

## Notification Preferences

- Keep one canonical event catalog shared by the API and Settings UI. Do not show switches for events that cannot actually produce a message.
- Default new configurable event preferences intentionally and document the choice. A missing preference should have a deterministic server-side fallback.
- Persist preferences per recipient account unless the product explicitly requires project-specific preferences.
- Apply the master switch and the event-level switch at queue insertion or immediately before delivery so every code path is covered.
- Account recovery, sign-in security alerts, and other messages required to keep the account secure must remain enabled. Show them in Settings as locked with a concise explanation instead of silently omitting them.
- Add a migration and regression tests whenever an event identifier is added, renamed, or retired. The emitted identifier, database filter, template catalog, and Settings switch must match exactly.

## Resend Setup

1. Add and verify a sending subdomain in Resend.
2. Add the exact DNS records shown by Resend. Use the DNS provider that is authoritative for the zone; do not change nameservers merely to add email records.
3. Create a least-privilege API key. Store it only in local environment configuration and the hosting provider's encrypted environment variables.
4. Send through the server-side Resend SDK or HTTPS API using a verified `from` address.
5. Configure webhook handling for delivery lifecycle events when the application needs durable notification history or user-visible status.

## Troubleshooting

- If the provider shows `delivered` but the recipient does not see the message, check Spam, Promotions, All Mail, and subject search before resending.
- If delivery fails, inspect the provider event details before changing code. Distinguish bounce, complaint, suppression, domain verification, and invalid-recipient failures.
- Never work around a suppression by repeatedly resending. Resolve the underlying reason first.
- When sending a test mail, report the subject, recipient, provider status, and whether the result means accepted or delivered. Do not expose secrets or full provider keys.

## Completion Checklist

- Server-only credentials configured locally and in hosting.
- Verified domain and role-based sender active.
- Relevant events implemented with branded HTML and plain text.
- Auth, validation, and authorization covered at the calling endpoint.
- Real authorized test sent and provider delivery status confirmed.
- Failure handling and observability available without leaking sensitive data.
- Every implemented configurable event is listed in Settings and its persisted switch suppresses outbox creation when disabled.
- Required account-security messages are visibly locked and cannot be disabled through the API.
