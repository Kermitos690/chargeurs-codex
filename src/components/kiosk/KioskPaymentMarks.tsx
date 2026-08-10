import type { ReactNode } from "react";

function BrandTile({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex h-16 min-w-[8.75rem] items-center justify-center rounded-2xl bg-white px-5 shadow-[0_14px_34px_rgba(0,0,0,.24)] ring-1 ring-black/5"
    >
      {children}
    </span>
  );
}

function TwintMark() {
  return (
    <BrandTile label="TWINT">
      <svg viewBox="0 0 150 42" className="h-9 w-auto" aria-hidden="true">
        <g transform="translate(2 5)">
          <rect x="7" y="0" width="11" height="11" rx="2.3" transform="rotate(45 12.5 5.5)" fill="#08B7D6" />
          <rect x="0" y="7" width="11" height="11" rx="2.3" transform="rotate(45 5.5 12.5)" fill="#3ED97B" />
          <rect x="14" y="7" width="11" height="11" rx="2.3" transform="rotate(45 19.5 12.5)" fill="#FFCF3F" />
          <rect x="7" y="14" width="11" height="11" rx="2.3" transform="rotate(45 12.5 19.5)" fill="#F05A75" />
        </g>
        <text x="42" y="29" fill="#111827" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="25" letterSpacing=".5">TWINT</text>
      </svg>
    </BrandTile>
  );
}

function ApplePayMark() {
  return (
    <BrandTile label="Apple Pay">
      <svg viewBox="0 0 145 42" className="h-9 w-auto" aria-hidden="true">
        <g transform="translate(2 5) scale(.9)">
          <path fill="#050505" d="M22.2 16.7c-.1-4.2 3.4-6.3 3.5-6.4-2-2.9-5.1-3.3-6.2-3.3-2.6-.3-5.1 1.5-6.4 1.5-1.3 0-3.3-1.5-5.5-1.4-2.8 0-5.5 1.7-6.9 4.2-3 5.2-.8 12.8 2.1 17 1.4 2.1 3.1 4.4 5.3 4.3 2.1-.1 3-1.4 5.6-1.4 2.6 0 3.3 1.4 5.6 1.3 2.3 0 3.8-2.1 5.2-4.2 1.6-2.4 2.3-4.7 2.3-4.8-.1 0-4.5-1.7-4.6-6.8ZM17.8 4.4c1.2-1.5 1.9-3.4 1.7-5.4-1.7.1-3.7 1.1-4.9 2.6-1.1 1.3-2 3.3-1.8 5.2 1.9.1 3.8-1 5-2.4Z" transform="translate(0 2) scale(.82)" />
        </g>
        <text x="34" y="29" fill="#050505" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="25">Pay</text>
      </svg>
    </BrandTile>
  );
}

function GooglePayMark() {
  return (
    <BrandTile label="Google Pay">
      <svg viewBox="0 0 160 42" className="h-9 w-auto" aria-hidden="true">
        <g transform="translate(4 7)">
          <path d="M25.6 14.3c0-1-.1-2-.3-2.9H13.5v5.5h6.8a5.8 5.8 0 0 1-2.5 3.8v3.6h4.1c2.4-2.2 3.7-5.5 3.7-10Z" fill="#4285F4"/>
          <path d="M13.5 26.5c3.4 0 6.3-1.1 8.4-3l-4.1-3.6a7.7 7.7 0 0 1-11.4-4.1H2.2v3.7a12.7 12.7 0 0 0 11.3 7Z" fill="#34A853"/>
          <path d="M6.4 15.8a7.5 7.5 0 0 1 0-4.8V7.3H2.2a12.7 12.7 0 0 0 0 12.2l4.2-3.7Z" fill="#FBBC05"/>
          <path d="M13.5 5.3c1.9 0 3.6.7 4.9 1.9l3.7-3.6A12.3 12.3 0 0 0 2.2 7.3L6.4 11a7.6 7.6 0 0 1 7.1-5.7Z" fill="#EA4335"/>
        </g>
        <text x="36" y="29" fill="#111827" fontFamily="Arial, Helvetica, sans-serif" fontWeight="600" fontSize="24">Pay</text>
      </svg>
    </BrandTile>
  );
}

function CardsMark() {
  return (
    <BrandTile label="Visa et Mastercard">
      <svg viewBox="0 0 180 42" className="h-9 w-auto" aria-hidden="true">
        <text x="2" y="29" fill="#1434CB" fontFamily="Arial, Helvetica, sans-serif" fontWeight="900" fontStyle="italic" fontSize="25">VISA</text>
        <g transform="translate(84 4)">
          <circle cx="18" cy="17" r="15" fill="#EB001B" />
          <circle cx="34" cy="17" r="15" fill="#F79E1B" />
          <path d="M26 5.4a15 15 0 0 1 0 23.2 15 15 0 0 1 0-23.2Z" fill="#FF5F00" />
        </g>
        <text x="137" y="28" fill="#111827" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="15">Carte</text>
      </svg>
    </BrandTile>
  );
}

export function KioskPaymentMarks({ cardLabel: _cardLabel }: { cardLabel: string }) {
  return (
    <div className="flex flex-wrap items-center gap-4" aria-label="TWINT, Apple Pay, Google Pay, Visa et Mastercard">
      <TwintMark />
      <ApplePayMark />
      <GooglePayMark />
      <CardsMark />
    </div>
  );
}
