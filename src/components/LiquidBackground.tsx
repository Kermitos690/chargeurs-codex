import { cn } from "@/lib/utils";

// Animated liquid-glass background: mesh gradient + floating blobs.
export function LiquidBackground({ className }: { className?: string }) {
  return (
    <div className={cn("fixed inset-0 -z-10 overflow-hidden bg-background", className)} aria-hidden>
      <div className="absolute inset-0 bg-mesh opacity-70" />
      <div className="absolute -left-32 top-10 h-96 w-96 rounded-full bg-primary/30 blur-3xl animate-blob" />
      <div className="absolute right-0 top-1/3 h-[28rem] w-[28rem] rounded-full bg-accent/25 blur-3xl animate-blob" style={{ animationDelay: "-6s" }} />
      <div className="absolute bottom-0 left-1/4 h-80 w-80 rounded-full bg-secondary/25 blur-3xl animate-blob" style={{ animationDelay: "-12s" }} />
      <div className="absolute inset-0 bg-gradient-hero" />
    </div>
  );
}
