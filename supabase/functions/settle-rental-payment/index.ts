// Internal service-role-only endpoint for final Chargeurs.ch settlement.
import { handleSettlementRequest } from "../_shared/settlementRuntime.ts";

Deno.serve(handleSettlementRequest);
