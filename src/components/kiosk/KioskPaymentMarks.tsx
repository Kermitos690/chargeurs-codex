import type { ReactNode } from "react";

const TWINT_LOGO_URL = "https://www.twint.ch/content/uploads/2017/03/twint-logo-open-graph.png";

function BrandTile({ children, label, compact = false }: { children: ReactNode; label: string; compact?: boolean }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`kiosk-payment-mark inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-[0_10px_28px_rgba(0,0,0,.24)] ring-1 ring-black/5 ${compact ? "w-[5.2rem]" : "w-[7.4rem]"}`}
      style={{ height: "3.35rem", minHeight: "3.35rem", maxHeight: "3.35rem", minWidth: compact ? "5.2rem" : "7.4rem", maxWidth: compact ? "5.2rem" : "7.4rem" }}
    >
      {children}
    </span>
  );
}

function TwintMark() {
  return (
    <BrandTile label="TWINT">
      <span className="flex h-full items-center gap-2 px-2.5">
        <img src={TWINT_LOGO_URL} alt="" className="h-8 w-8 rounded-md object-cover object-top" referrerPolicy="no-referrer" />
        <span className="text-base font-black tracking-[.04em] text-black">TWINT</span>
      </span>
    </BrandTile>
  );
}

function ApplePayMark() {
  return <BrandTile label="Apple Pay" compact><svg viewBox="0 0 110 42" className="h-7 w-auto" aria-hidden="true"><path fill="#050505" d="M24 18.2c-.1-4 3.2-6 3.4-6.1-1.9-2.8-4.9-3.1-6-3.2-2.5-.3-4.9 1.4-6.2 1.4-1.2 0-3.2-1.4-5.2-1.4-2.7 0-5.2 1.6-6.6 4-2.8 5-.7 12.2 2 16.2 1.3 2 3 4.2 5.1 4.1 2-.1 2.8-1.3 5.3-1.3s3.2 1.3 5.4 1.2c2.2 0 3.6-2 5-4 1.5-2.3 2.2-4.5 2.2-4.6-.1 0-4.3-1.6-4.4-6.3Zm-4.2-11.7c1.1-1.4 1.8-3.3 1.6-5.1-1.6.1-3.6 1-4.7 2.5-1 1.2-1.9 3.1-1.7 4.9 1.8.1 3.6-.9 4.8-2.3Z" transform="scale(.78) translate(3 5)"/><text x="31" y="29" fill="#050505" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="24">Pay</text></svg></BrandTile>;
}

function GooglePayMark() {
  return <BrandTile label="Google Pay" compact><span className="text-lg font-bold text-slate-900">G Pay</span></BrandTile>;
}
function VisaMark() { return <BrandTile label="Visa" compact><span className="px-2 text-xl font-black italic text-[#1434CB]">VISA</span></BrandTile>; }
function MastercardMark() { return <BrandTile label="Mastercard" compact><svg viewBox="0 0 76 42" className="h-7 w-auto" aria-hidden="true"><circle cx="29" cy="21" r="15" fill="#EB001B"/><circle cx="47" cy="21" r="15" fill="#F79E1B"/><path d="M38 9.2a15 15 0 0 1 0 23.6 15 15 0 0 1 0-23.6Z" fill="#FF5F00"/></svg></BrandTile>; }
function AmexMark() { return <BrandTile label="American Express" compact><span className="rounded bg-[#1976D2] px-2 py-1 text-xs font-black text-white">AMEX</span></BrandTile>; }

export function KioskPaymentMarks({ cardLabel: _cardLabel }: { cardLabel: string }) {
  return <div className="kiosk-payment-marks flex max-w-full flex-wrap items-center gap-2" aria-label="TWINT, Apple Pay, Google Pay, Visa, Mastercard et American Express"><TwintMark/><ApplePayMark/><GooglePayMark/><VisaMark/><MastercardMark/><AmexMark/></div>;
}
