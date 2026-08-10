import { useI18n, LANGS, Lang } from "@/i18n/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-full border border-white/15 bg-slate-950/55 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.05)] backdrop-blur-xl", className)}>
      {LANGS.map((l) => {
        const active = lang === l;
        return (
          <button
            key={l}
            type="button"
            aria-pressed={active}
            onClick={() => setLang(l as Lang)}
            className={cn(
              "min-w-12 rounded-full px-4 py-2 text-sm font-extrabold uppercase tracking-wide transition-all",
              active
                ? "bg-[linear-gradient(135deg,#248cff,#635bff)] text-white ring-2 ring-cyan-300/80 shadow-[0_0_22px_rgba(37,148,255,.55)]"
                : "text-white/58 hover:bg-white/7 hover:text-white",
            )}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}
