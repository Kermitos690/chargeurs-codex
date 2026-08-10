import type { ReactNode } from "react";

const TWINT_LOGO_URL = "https://www.twint.ch/content/uploads/2017/03/twint-logo-open-graph.png";

function BrandTile({ children, label, compact = false }: { children: ReactNode; label: string; compact?: boolean }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`kiosk-payment-mark inline-flex items-center justify-center rounded-xl bg-white shadow-[0_10px_28px_rgba(0,0,0,.24)] ring-1 ring-black/5 ${compact ? "min-w-[5.2rem]" : "min-w-[7.4rem]"}`}
    >
      {children}
    </span>
  );
}

function TwintMark() {
  return (
    <BrandTile label="TWINT">
      <span className="flex h-full items-center gap-2.5 px-3">
        <img
          src={TWINT_LOGO_URL}
          alt=""
          className="h-10 w-10 rounded-lg object-cover object-top"
          referrerPolicy="no-referrer"
        />
        <span className="text-[1.18rem] font-black tracking-[.06em] text-black">TWINT</span>
      </span>
    </BrandTile>
  );
}

function ApplePayMark() {
  return (
    <BrandTile label="Apple Pay" compact>
      <svg viewBox="0 0 110 42" className="h-8 w-auto" aria-hidden="true">
        <path fill="#050505" d="M24 18.2c-.1-4 3.2-6 3.4-6.1-1.9-2.8-4.9-3.1-6-3.2-2.5-.3-4.9 1.4-6.2 1.4-1.2 0-3.2-1.4-5.2-1.4-2.7 0-5.2 1.6-6.6 4-2.8 5-.7 12.2 2 16.2 1.3 2 3 4.2 5.1 4.1 2-.1 2.8-1.3 5.3-1.3s3.2 1.3 5.4 1.2c2.2 0 3.6-2 5-4 1.5-2.3 2.2-4.5 2.2-4.6-.1 0-4.3-1.6-4.4-6.3Zm-4.2-11.7c1.1-1.4 1.8-3.3 1.6-5.1-1.6.1-3.6 1-4.7 2.5-1 1.2-1.9 3.1-1.7 4.9 1.8.1 3.6-.9 4.8-2.3Z" transform="scale(.78) translate(3 5)" />
        <text x="31" y="29" fill="#050505" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="24">Pay</text>
      </svg>
    </BrandTile>
  );
}

function GooglePayMark() {
  return (
    <BrandTile label="Google Pay" compact>
      <svg viewBox="0 0 118 42" className="h-8 w-auto" aria-hidden="true">
        <g transform="translate(4 7)">
          <path d="M25.6 14.3c0-1-.1-2-.3-2.9H13.5v5.5h6.8a5.8 5.8 0 0 1-2.5 3.8v3.6h4.1c2.4-2.2 3.7-5.5 3.7-10Z" fill="#4285F4"/>
          <path d="M13.5 26.5c3.4 0 6.3-1.1 8.4-3l-4.1-3.6a7.7 7.7 0 0 1-11.4-4.1H2.2v3.7a12.7 12.7 0 0 0 11.3 7Z" fill="#34A853"/>
          <path d="M6.4 15.8a7.5 7.5 0 0 1 0-4.8V7.3H2.2a12.7 12.7 0 0 0 0 12.2l4.2-3.7Z" fill="#FBBC05"/>
          <path d="M13.5 5.3c1.9 0 3.6.7 4.9 1.9l3.7-3.6A12.3 12.3 0 0 0 2.2 7.3L6.4 11a7.6 7.6 0 0 1 7.1-5.7Z" fill="#EA4335"/>
        </g>
        <text x="36" y="29" fill="#111827" fontFamily="Arial, Helvetica, sans-serif" fontWeight="600" fontSize="23">Pay</text>
      </svg>
    </BrandTile>
  );
}

function VisaMark() {
  return <BrandTile label="Visa" compact><span className="px-3 text-[1.45rem] font-black italic tracking-[-.04em] text-[#1434CB]">VISA</span></BrandTile>;
}

function MastercardMark() {
  return (
    <BrandTile label="Mastercard" compact>
      <svg viewBox="0 0 76 42" className="h-8 w-auto" aria-hidden="true">
        <circle cx="29" cy="21" r="15" fill="#EB001B" />
        <circle cx="47" cy="21" r="15" fill="#F79E1B" />
        <path d="M38 9.2a15 15 0 0 1 0 23.6 15 15 0 0 1 0-23.6Z" fill="#FF5F00" />
      </svg>
    </BrandTile>
  );
}

function AmexMark() {
  return <BrandTile label="American Express" compact><span className="rounded bg-[#1976D2] px-2.5 py-1 text-sm font-black tracking-tight text-white">AMEX</span></BrandTile>;
}

export function KioskPaymentMarks({ cardLabel: _cardLabel }: { cardLabel: string }) {
  return (
    <div className="kiosk-payment-marks flex flex-wrap items-center gap-2.5" aria-label="TWINT, Apple Pay, Google Pay, Visa, Mastercard et American Express">
      <TwintMark />
      <ApplePayMark />
      <GooglePayMark />
      <VisaMark />
      <MastercardMark />
      <AmexMark />
    </div>
  );
}
