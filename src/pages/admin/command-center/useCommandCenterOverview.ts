import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { OverviewData } from "./types";

export function useCommandCenterOverview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);

    const { data: result, error: invokeError } = await supabase.functions.invoke<OverviewData>("admin-overview-read", { body: {} });
    if (invokeError || !result?.ok) {
      setError(result?.error ?? invokeError?.message ?? "Le Product Command Center n’a pas pu charger les données réelles.");
      if (!quiet) setLoading(false);
      return;
    }

    setData(result);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh(false);
    const timer = window.setInterval(() => void refresh(true), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { data, loading, error, refresh };
}
