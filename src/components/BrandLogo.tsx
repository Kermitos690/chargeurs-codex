import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandLogo({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "h-8 w-8", md: "h-11 w-11", lg: "h-16 w-16" }[size];
  const text = { sm: "text-lg", md: "text-2xl", lg: "text-4xl" }[size];
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className={cn("relative grid place-items-center rounded-2xl bg-gradient-primary shadow-glow liquid-border", dims)}>
        <Zap className="h-1/2 w-1/2 text-primary-foreground" fill="currentColor" />
      </div>
      <span className={cn("font-display font-extrabold tracking-tight", text)}>
        Chargeurs<span className="text-gradient-cyan">.ch</span>
      </span>
    </div>
  );
}
