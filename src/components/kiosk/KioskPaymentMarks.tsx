import type { ReactNode } from "react";

// Official TWINT-hosted brand artwork. A text fallback remains underneath so
// an old/offline WebView never leaves an empty payment mark.
const TWINT_LOGO_URL = "https://www.twint.ch/content/uploads/2017/03/twint-logo-open-graph.png";

function BrandMark({ children, label, wide = false }: { children: ReactNode; label: string; wide?: boolean }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`kiosk-payment-mark inline-flex shrink-0 items-center justify-center overflow-hidden ${wide ? "w-[7.4rem]" : "w-[5.2rem]"}`}
      style={{ height: "2.75rem", minHeight: "2.75rem", maxHeight: "2.75rem" }}
    >
      {children}
    </span>
  );
}

function TwintMark() {
  return (
    <BrandMark label="TWINT" wide>
      <span className="relative flex h-full w-full items-center justify-center">
        <strong className="text-lg font-black tracking-[.05em] text-white">TWINT</strong>
        <img
          src={TWINT_LOGO_URL}
          alt=""
          className="absolute inset-0 h-full w-full scale-[1.28] object-contain"
          referrerPolicy="no-referrer"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      </span>
    </BrandMark>
  );
}

function ApplePayMark() {
  return (
    <BrandMark label="Apple Pay" wide>
      <svg viewBox="0 0 112 42" className="h-7 w-auto" aria-hidden="true">
        <path fill="#fff" d="M24 18.2c-.1-4 3.2-6 3.4-6.1-1.9-2.8-4.9-3.1-6-3.2-2.5-.3-4.9 1.4-6.2 1.4-1.2 0-3.2-1.4-5.2-1.4-2.7 0-5.2 1.6-6.6 4-2.8 5-.7 12.2 2 16.2 1.3 2 3 4.2 5.1 4.1 2-.1 2.8-1.3 5.3-1.3s3.2 1.3 5.4 1.2c2.2 0 3.6-2 5-4 1.5-2.3 2.2-4.5 2.2-4.6-.1 0-4.3-1.6-4.4-6.3Zm-4.2-11.7c1.1-1.4 1.8-3.3 1.6-5.1-1.6.1-3.6 1-4.7 2.5-1 1.2-1.9 3.1-1.7 4.9 1.8.1 3.6-.9 4.8-2.3Z" transform="scale(.78) translate(3 5)"/>
        <text x="31" y="29" fill="#fff" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="24">Pay</text>
      </svg>
    </BrandMark>
  );
}

function GooglePayMark() {
  return (
    <BrandMark label="Google Pay" wide>
      <svg viewBox="0 0 126 42" className="h-7 w-auto" aria-hidden="true">
        <path fill="#4285F4" d="M21.7 20.5c0-1-.1-1.8-.3-2.7H11.2v5h5.9a5.1 5.1 0 0 1-2.2 3.3v3.3h4.3c2.5-2.3 4-5.7 4-8.9Z"/>
        <path fill="#34A853" d="M11.2 31c3.6 0 6.6-1.2 8.8-3.2l-4.3-3.3c-1.2.8-2.7 1.3-4.5 1.3-3.5 0-6.4-2.3-7.5-5.5H-.7v3.4A13.3 13.3 0 0 0 11.2 31Z" transform="translate(3 0)"/>
        <path fill="#FBBC04" d="M3.7 20.3a8 8 0 0 1 0-5.1v-3.4H-.7a13.3 13.3 0 0 0 0 11.9l4.4-3.4Z" transform="translate(3 0)"/>
        <path fill="#EA4335" d="M11.2 9.7c2 0 3.7.7 5.1 2l3.8-3.8A12.8 12.8 0 0 0 11.2 4 13.3 13.3 0 0 0-.7 11.8l4.4 3.4c1.1-3.2 4-5.5 7.5-5.5Z" transform="translate(3 0)"/>
        <text x="31" y="29" fill="#fff" fontFamily="Arial, Helvetica, sans-serif" fontWeight="600" fontSize="24">Pay</text>
      </svg>
    </BrandMark>
  );
}

function VisaMark() {
  return <BrandMark label="Visa"><span className="px-2 text-xl font-black italic tracking-[-.04em] text-white">VISA</span></BrandMark>;
}

function MastercardMark() {
  return (
    <BrandMark label="Mastercard">
      <svg viewBox="0 0 76 42" className="h-7 w-auto" aria-hidden="true">
        <circle cx="29" cy="21" r="15" fill="#EB001B"/>
        <circle cx="47" cy="21" r="15" fill="#F79E1B"/>
        <path d="M38 9.2a15 15 0 0 1 0 23.6 15 15 0 0 1 0-23.6Z" fill="#FF5F00"/>
      </svg>
    </BrandMark>
  );
}

function AmexMark() {
  return <BrandMark label="American Express" wide><span className="rounded-[.3rem] bg-[#1976D2] px-3 py-1.5 text-xs font-black tracking-[-.02em] text-white">AMERICAN EXPRESS</span></BrandMark>;
}

export function KioskPaymentMarks({ cardLabel: _cardLabel }: { cardLabel: string }) {
  return (
    <div className="kiosk-payment-marks flex max-w-full flex-wrap items-center gap-4" aria-label="TWINT, Apple Pay, Google Pay, Visa, Mastercard et American Express">
      <TwintMark />
      <ApplePayMark />
      <GooglePayMark />
      <VisaMark />
      <MastercardMark />
      <AmexMark />
    </div>
  );
}
