// admin-operations-read — read-only support/operations projections.
// Returns only the fields needed by the UI; no raw provider payloads or secrets.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireRoles } from "../_shared/db.ts";

const READ_ROLES = [
  "super_admin", "admin", "operations_admin", "support_agent",
  "maintenance_technician", "operator",
] as const;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store"}});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  const db=adminClient();
  const userId=await requireRoles(req,db,READ_ROLES);
  if(!userId) return json({ok:false,error:"FORBIDDEN"},403);
  const body=await req.json().catch(()=>({}));
  const action=String(body.action??"");

  if(action==="events"){
    const{data,error}=await db.from("cabinet_events")
      .select("id,station_id,event_type,severity,received_at,external_event_id")
      .order("received_at",{ascending:false}).limit(200);
    if(error) return json({ok:false,error:"EVENTS_READ_FAILED"},500);
    return json({ok:true,events:data??[]});
  }

  if(action==="rental_health"){
    const [sessions,lastWebhook,lastCn,stripeErrors,failed,working,settlements]=await Promise.all([
      db.from("rental_sessions").select("state"),
      db.from("webhook_events").select("created_at").eq("provider","stripe").order("created_at",{ascending:false}).limit(1),
      db.from("api_logs").select("created_at").eq("service","chargenow").is("error",null).order("created_at",{ascending:false}).limit(1),
      db.from("api_logs").select("id",{count:"exact",head:true}).eq("service","stripe").not("error","is",null),
      db.from("rental_sessions").select("id",{count:"exact",head:true}).in("settlement_status",["failed","manual_review","supplemental_required"]),
      db.from("rental_sessions").select("id",{count:"exact",head:true}).eq("settlement_status","settling"),
      db.from("rental_sessions")
        .select("id,public_session_code,station_id,state,settlement_status,settlement_attempts,settlement_error,failure_code,final_amount_cents,currency,returned_at,updated_at")
        .in("settlement_status",["failed","manual_review","supplemental_required","settling"])
        .order("updated_at",{ascending:false}).limit(20),
    ]);
    for(const result of [sessions,lastWebhook,lastCn,stripeErrors,failed,working,settlements]){
      if(result.error) return json({ok:false,error:"RENTAL_HEALTH_READ_FAILED"},500);
    }
    const counts:Record<string,number>={};
    for(const row of sessions.data??[]){const state=String(row.state??"unknown");counts[state]=(counts[state]??0)+1;}
    return json({
      ok:true,
      counts,
      lastWebhook:lastWebhook.data?.[0]?.created_at??null,
      lastChargeNow:lastCn.data?.[0]?.created_at??null,
      stripeApiErrors:stripeErrors.count??0,
      settlementFailed:failed.count??0,
      settlementWorking:working.count??0,
      settlements:settlements.data??[],
    });
  }

  return json({ok:false,error:"UNKNOWN_ACTION"},400);
});
