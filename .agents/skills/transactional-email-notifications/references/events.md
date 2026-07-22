# Transactional Event Matrix

Use this as a starting point; implement only events that genuinely exist in the product.

| Event | Recipient | Essential content | CTA | Preference rule |
| --- | --- | --- | --- | --- |
| Account created | New user | Welcome, account role, next useful action | Open account | Product-specific; lock when required for account security or onboarding |
| Email verification | New user | Single-use verification link and expiry | Verify email | Always enabled and locked |
| Password reset | Account owner | Single-use reset link, expiry, security notice | Reset password | Always enabled and locked |
| Payment confirmed | Buyer | Amount, currency, reference, item, next step | View receipt/order | Normally always enabled; follow applicable receipt requirements |
| Payment failed | Buyer | Clear failure status, safe retry path | Update payment | Normally always enabled while payment is pending |
| Booking/order confirmed | Buyer and, if applicable, provider | Dates, guests/items, reference, contact path | View details | Normally always enabled when it is the transaction record |
| New bid/offer | Participating user | Current amount, their last amount, deadline | View auction | Configurable |
| Outbid | Previous leading bidder | New leading amount and time remaining | Increase bid | Configurable unless product rules require it |
| Auction won/lost | Bidder and provider | Final status, final amount, payment/fulfilment path | View outcome | Normally always enabled |
| Partner/admin action required | Responsible operator | What changed, who owns the next step, deadline | Review item | Configurable unless operationally mandatory |

## Minimum payload

Pass structured event data to a renderer rather than concatenating arbitrary HTML. Typical fields are recipient name, locale, entity ID, public URL, amount/currency, date/time, and a concise status label. Format currency and dates according to the recipient locale.

## Preference contract

For each configurable event, keep a stable machine identifier such as `entity.action`, a localized label and description, a group, a deterministic default, and a `configurable` flag. The backend must reject unknown identifiers and ignore attempts to disable locked events. Test catalog uniqueness and verify that every emitted configurable identifier exists in the catalog.

## Security

Do not place sensitive personal data, raw passwords, payment card data, or long-lived access tokens in an email. Use short-lived, single-use URLs for account recovery and verification. Treat provider webhooks as untrusted until their signature is verified.
