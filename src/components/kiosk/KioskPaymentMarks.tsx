import { CreditCard } from "lucide-react";

function TwintMark() {
  return (
    <span className="inline-flex items-center gap-2.5 rounded-xl bg-white px-4 py-2.5 text-lg font-black tracking-wide text-slate-950 shadow-lg shadow-black/15">
      <span className="grid h-5 w-5 rotate-45 grid-cols-2 gap-[2px]" aria-hidden="true">
        <i className="rounded-[2px] bg-rose-500" />
        <i className="rounded-[2px] bg-cyan-400" />
        <i className="rounded-[2px] bg-emerald-400" />
        <i className="rounded-[2px] bg-amber-400" />
      </span>
      TWINT
    </span>
  );
}

function ApplePayMark() {
  return (
    <span className="inline-flex items-center rounded-xl bg-white px-4 py-2.5 text-xl font-black tracking-tight text-slate-950 shadow-lg shadow-black/15">
      <span className="mr-1.5 text-2xl leading-none" aria-hidden="true"></span>Pay
    </span>
  );
}

function GooglePayMark() {
  return (
    <span className="inline-flex items-center rounded-xl bg-white px-4 py-2.5 text-lg font-black text-slate-950 shadow-lg shadow-black/15">
      <span className="mr-1.5 font-black text-blue-600" aria-hidden="true">G</span>Pay
    </span>
  );
}

function CardMark({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-lg font-black text-slate-950 shadow-lg shadow-black/15">
      <CreditCard className="h-5 w-5" aria-hidden="true" />{label}
    </span>
  );
}

export function KioskPaymentMarks({ cardLabel }: { cardLabel: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3" aria-label="TWINT, Apple Pay, Google Pay et carte">
      <TwintMark />
      <ApplePayMark />
      <GooglePayMark />
      <CardMark label={cardLabel} />
    </div>
  );
}
