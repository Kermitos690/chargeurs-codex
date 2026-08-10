// Internal Edge Function entrypoint for final Chargeurs.ch payment settlement.
import { handleSettlementRequestV3 } from "../_shared/settlementRuntimeV3.ts";

Deno.serve(handleSettlementRequestV3);
