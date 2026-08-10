// Internal Edge Function entrypoint for final Chargeurs.ch payment settlement.
import { handleSettlementRequest } from "../_shared/settlementRuntime.ts";

Deno.serve(handleSettlementRequest);
