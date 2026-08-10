# Chargeurs.ch brand system

Canonical customer-facing name: **Chargeurs.ch**.

Frontend constants live in `src/config/brand.ts`; Deno Edge Function constants
live in `supabase/functions/_shared/brand.ts`. The duplicated runtime boundary
is intentional: browser TypeScript and Supabase Deno do not share a safe build
artifact.

| Token | Value |
| --- | --- |
| Navy | `#0a1024` |
| Electric blue | `#2764ff` |
| Violet | `#7b3ff2` |
| QR foreground | `#0a1024` |
| QR background | `#ffffff` |
| Support | `support@chargeurs.ch` |

Stripe Checkout remains Stripe-hosted. Its exact page layout cannot be made
pixel-identical to the kiosk; use Stripe Dashboard branding rather than
imitating Checkout.
