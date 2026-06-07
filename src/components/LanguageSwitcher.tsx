import { useI18n, LANGS, Lang } from "@/i18n/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={cn("glass inline-flex gap-1 rounded-full p-1", className)}>
      {LANGS.map((l) => (
        <button
          key={l}
          onClick={() => setLang(l as Lang)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-semibold uppercase transition-all",
            lang === l ? "bg-gradient-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
