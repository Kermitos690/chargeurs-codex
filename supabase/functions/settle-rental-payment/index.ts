// Internal Edge Function entrypoint for final Chargeurs.ch payment settlement.
import { handleSettlementRequestV2 } from "../_shared/settlementRuntimeV2.ts";

Deno.serve(handleSettlementRequestV2);
