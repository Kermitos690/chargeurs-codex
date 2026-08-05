# Stripe payment method matrix (staging)

| Method | Kiosk | Hosted Checkout | Test validation status | Prerequisites / limits |
| --- | --- | --- | --- | --- |
| Card | never collected | Stripe may show it on phone | code only; not called | Stripe Test key, CHF Checkout |
| Link | never collected | Stripe may show it on phone | not tested | enabled/eligible in Dashboard and customer context |
| Apple Pay | never shown in WebView | Stripe may show it on compatible iPhone | not tested | eligible account/domain/device/card; Stripe controls visibility |
| Google Pay | never shown in WebView | Stripe may show it on compatible Android | not tested | eligible account/browser/device; Stripe controls visibility |
| TWINT | never opened on kiosk | Stripe may redirect from phone if eligible | not tested | supported Stripe account/country/currency and Dashboard activation |

All rows are deliberately marked unvalidated until a real hosted Stripe Test
Checkout on the relevant phone offers the method and completes its documented
test flow. The source must not fake availability labels on the kiosk.
