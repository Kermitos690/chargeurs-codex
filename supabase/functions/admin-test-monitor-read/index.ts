// admin-test-monitor-read — server-side, redacted staging test reports.
// Raw provider/payment logs never need to reach the browser before redaction.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireRoles } from "../_shared/db.ts";

const READ_ROLES = ["super_admin", "admin", "operations_admin"] as const;
const SENSITIVE_PARTS = [
  "secret", "token", "authorization", "apikey", "api_key", "password",
  "client_secret", "webhook_secret", "basic_auth", "card", "cvc", "pan",
];

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store"}});

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_PARTS.some((part) => lower.includes(part))) {
      // Identifiers useful for correlation are allowed only in their dedicated,
      // already-redacted session fields, never copied from arbitrary payloads.
      out[key] = "***";
    } else {
      out[key] = redact(child);
    }
  }
  return out;
}

function safeSession(row: Record<string, unknown>) {
  const allowed = [
    "id","public_session_code","station_id","cabinet_id","selected_slot_num","battery_id","state",
    "amount","amount_expected","amount_paid","currency","price_profile_id","price_profile_version",
    "pricing_snapshot","pricing_snapshot_hash","stripe_checkout_session_id","stripe_payment_intent_id",
    "stripe_payment_method_type","apifox_trade_no","chargenow_order_id","chargenow_status",
    "error_code","error_message","failure_code","failure_message","retry_count","settlement_status",
    "settlement_error","final_amount_cents","captured_amount_cents","refunded_amount_cents",
    "created_at","paid_at","started_at","ejected_at","returned_at","completed_at","closed_at","cancelled_at","updated_at",
  ];
  const out: Record<string, unknown> = {};
  for (const key of allowed) out[key] = row[key] ?? null;
  return out;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  const db=adminClient();
  const userId=await requireRoles(req,db,READ_ROLES);
  if(!userId) return json({ok:false,error:"FORBIDDEN"},403);
  const body=await req.json().catch(()=>({}));
  const action=String(body.action??"");

  try {
    if(action==="recent"){
      const{data,error}=await db.from("rental_sessions")
        .select("id,public_session_code,station_id,state,created_at")
        .order("created_at",{ascending:false}).limit(20);
      if(error) throw error;
      return json({ok:true,sessions:data??[]});
    }

    if(action==="resolve"){
      const query=String(body.query??"").trim();
      if(!query) return json({ok:false,error:"QUERY_REQUIRED"},400);
      if(/^[0-9a-f-]{36}$/i.test(query)){
        const{data}=await db.from("rental_sessions").select("id").eq("id",query).maybeSingle();
        return data?.id?json({ok:true,id:data.id}):json({ok:false,error:"SESSION_NOT_FOUND"},404);
      }
      const{data}=await db.from("rental_sessions").select("id").eq("public_session_code",query).maybeSingle();
      return data?.id?json({ok:true,id:data.id}):json({ok:false,error:"SESSION_NOT_FOUND"},404);
    }

    if(action==="mutation_tests"){
      const{data,error}=await db.from("test_runs")
        .select("id,endpoint_code,endpoint_name,level,verdict,environment,cabinet_id,correlation_id,request_redacted,response_redacted,status_code,duration_ms,physical_test_required,error,created_at")
        .order("created_at",{ascending:false}).limit(300);
      if(error) throw error;
      return json({ok:true,runs:redact(data??[])});
    }

    if(action==="report"){
      const rentalId=String(body.rentalId??"");
      if(!/^[0-9a-f-]{36}$/i.test(rentalId)) return json({ok:false,error:"INVALID_RENTAL_ID"},400);
      const{data:session,error:sessionError}=await db.from("rental_sessions").select("*").eq("id",rentalId).maybeSingle();
      if(sessionError) throw sessionError;
      if(!session) return json({ok:false,error:"SESSION_NOT_FOUND"},404);
      const s=session as Record<string,unknown>;
      const tradeNo=typeof s.apifox_trade_no==="string"?s.apifox_trade_no:null;
      const stationId=typeof s.station_id==="string"?s.station_id:null;

      const stripeLogs=db.from("api_logs").select("id,service,endpoint,method,status_code,request,response,error,created_at")
        .eq("service","stripe").contains("request",{rentalSessionId:rentalId}).order("created_at",{ascending:true}).limit(80);
      const cnLogs=tradeNo
        ? db.from("api_logs").select("id,service,endpoint,method,status_code,request,response,error,created_at").eq("service","chargenow").contains("request",{tradeNo}).order("created_at",{ascending:true}).limit(80)
        : Promise.resolve({data:[],error:null});
      const callbacks=tradeNo
        ? db.from("chargenow_callbacks").select("id,trade_no,station_id,status,idempotency_key,raw,processed,created_at").eq("trade_no",tradeNo).order("created_at",{ascending:true})
        : Promise.resolve({data:[],error:null});
      const cabinetEvents=stationId
        ? db.from("cabinet_events").select("id,station_id,event_type,severity,received_at,external_event_id").eq("station_id",stationId).order("received_at",{ascending:false}).limit(30)
        : Promise.resolve({data:[],error:null});

      const[payments,refunds,rentalEvents,chargeNowLogs,stripeApiLogs,chargeNowCallbacks,events]=await Promise.all([
        db.from("payments").select("id,rental_session_id,amount,currency,payment_method,status,amount_authorized_cents,amount_captured_cents,amount_refunded_cents,created_at,refunded_at").eq("rental_session_id",rentalId).order("created_at",{ascending:true}),
        db.from("refunds").select("*").eq("rental_session_id",rentalId).order("created_at",{ascending:true}),
        db.from("rental_events").select("*").eq("rental_session_id",rentalId).order("created_at",{ascending:true}),
        cnLogs,
        stripeLogs,
        callbacks,
        cabinetEvents,
      ]);
      for(const result of[payments,refunds,rentalEvents,chargeNowLogs,stripeApiLogs,chargeNowCallbacks,events]) if(result.error) throw result.error;

      return json({ok:true,report:{
        session:safeSession(s),
        payments:redact(payments.data??[]),
        refunds:redact(refunds.data??[]),
        rental_events:redact(rentalEvents.data??[]),
        chargenow_api_logs:redact(chargeNowLogs.data??[]),
        stripe_api_logs:redact(stripeApiLogs.data??[]),
        chargenow_callbacks:redact(chargeNowCallbacks.data??[]),
        cabinet_events:redact(events.data??[]),
        generated_at:new Date().toISOString(),
      }});
    }

    return json({ok:false,error:"UNKNOWN_ACTION"},400);
  } catch(error) {
    console.error("admin-test-monitor-read",error instanceof Error?error.message:"UNKNOWN_ERROR");
    return json({ok:false,error:"TEST_MONITOR_READ_FAILED"},500);
  }
});
