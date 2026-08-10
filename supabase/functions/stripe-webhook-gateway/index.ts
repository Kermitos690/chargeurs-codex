import Stripe from "https://esm.sh/stripe@18.5.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const db=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});

function canonicalize(v:unknown):string{
  if(v===null||typeof v!=="object") return JSON.stringify(v);
  if(Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  const o=v as Record<string,unknown>;
  return `{${Object.keys(o).sort().map(k=>`${JSON.stringify(k)}:${canonicalize(o[k])}`).join(",")}}`;
}
async function hashSnapshot(v:unknown){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonicalize(v)));return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("");}

async function recoverManualCard(rawEvent:any){
  const key=(Deno.env.get("STRIPE_SECRET_KEY")??"").trim();
  if(!(key.startsWith("sk_test_")||key.startsWith("rk_test_"))) throw new Error("STRIPE_TEST_KEY_REQUIRED");
  const stripe=new Stripe(key,{apiVersion:"2025-09-30.clover",httpClient:Stripe.createFetchHttpClient()});
  const object=rawEvent?.data?.object??{};
  const rentalId=typeof object?.metadata?.rental_session_id==="string"?object.metadata.rental_session_id:null;
  let piId:string|null=null;
  if(rawEvent?.type==="payment_intent.amount_capturable_updated") piId=typeof object?.id==="string"?object.id:null;
  if(rawEvent?.type==="checkout.session.completed") piId=typeof object?.payment_intent==="string"?object.payment_intent:null;
  if(!rentalId||!piId) return {handled:false,reason:"NOT_TARGET_EVENT"};

  const pi=await stripe.paymentIntents.retrieve(piId);
  const cardCapture=(pi.payment_method_options as any)?.card?.capture_method??null;
  if(pi.status!=="requires_capture"||cardCapture!=="manual"||Number(pi.amount_capturable??0)<=0) return {handled:false,reason:"NOT_MANUAL_CARD_AUTH"};

  const admin=db();
  const {data:session,error:sessionErr}=await admin.from("rental_sessions").select("*").eq("id",rentalId).maybeSingle();
  if(sessionErr) throw sessionErr;
  if(!session) return {handled:false,reason:"SESSION_NOT_FOUND"};
  const expected=Math.round(Number(session.deposit_amount_cents??session.pricing_snapshot?.deposit_cents??0));
  const observed=Number(pi.amount??0);
  const currency=String(pi.currency??"").toLowerCase();
  const expectedCurrency=String(session.currency??"CHF").toLowerCase();
  const storedHash=String(session.pricing_snapshot_hash??"");
  const computedHash=session.pricing_snapshot?await hashSnapshot(session.pricing_snapshot):"";
  const metaHash=String(pi.metadata?.pricing_snapshot_hash??"");
  if(expected<=0||observed!==expected||currency!==expectedCurrency||!storedHash||computedHash!==storedHash||(metaHash&&metaHash!==storedHash)){
    await admin.from("audit_logs").insert({action:"stripe.gateway.manual_card_rejected",target:rentalId,data:{expected,observed,currency,expected_currency:expectedCurrency,snapshot_ok:computedHash===storedHash,metadata_ok:!metaHash||metaHash===storedHash,event_id:rawEvent.id}}).then(()=>{},()=>{});
    throw new Error("PAYMENT_INTEGRITY_MISMATCH");
  }

  const pmId=typeof pi.payment_method==="string"?pi.payment_method:pi.payment_method?.id??null;
  const customerId=typeof pi.customer==="string"?pi.customer:pi.customer?.id??null;
  let customerEmail:string|null=null;
  if(session.stripe_checkout_session_id){try{const co=await stripe.checkout.sessions.retrieve(String(session.stripe_checkout_session_id));customerEmail=co.customer_details?.email??co.customer_email??null;}catch{/* best effort */}}

  const {data:claimed,error:claimErr}=await admin.from("rental_sessions").update({state:"payment_succeeded",stripe_payment_intent_id:pi.id,stripe_customer_id:customerId,stripe_payment_method_id:pmId,stripe_payment_method_type:"card",customer_email:customerEmail??session.customer_email??null,amount_paid:0,captured_amount_cents:0,settlement_strategy:"manual_capture",settlement_status:"authorized",settlement_error:null,paid_at:new Date().toISOString(),failure_code:null,failure_message:null}).eq("id",rentalId).in("state",["checkout_created","created","payment_processing","payment_pending"]).select("id");
  if(claimErr) throw claimErr;
  if(!claimed?.length) return {handled:true,replayed:true};

  const {error:payErr}=await admin.from("payments").update({status:"authorized",stripe_payment_intent_id:pi.id,payment_method:"card",capture_method:"manual",settlement_strategy:"manual_capture",amount_authorized_cents:Number(pi.amount_capturable??pi.amount??expected),amount_captured_cents:0,stripe_payment_method_id:pmId,stripe_customer_id:customerId,raw_webhook:{id:rawEvent.id,type:rawEvent.type,intent_status:pi.status,top_level_capture_method:pi.capture_method,card_capture_method:cardCapture}}).eq("rental_session_id",rentalId);
  if(payErr) throw payErr;

  const {data:snap,error:snapErr}=await admin.from("rental_orchestrator_snapshots").select("state,version").eq("rental_id",rentalId).maybeSingle();
  if(snapErr) throw snapErr;
  if(!snap||snap.state!=="payment_pending") throw new Error(`ORCHESTRATOR_NOT_PAYMENT_PENDING_${String(snap?.state??"missing")}`);
  const {error:appendErr}=await admin.rpc("append_rental_orchestrator_event",{p_rental_id:rentalId,p_expected_version:Number(snap.version??0),p_event_type:"payment_authorized",p_idempotency_key:`payment_authorized:${pi.id}`,p_occurred_at:new Date().toISOString(),p_metadata:{source:"stripe_webhook_gateway_clover",stripe_event_id:rawEvent.id,method_type:"card",settlement_strategy:"manual_capture",authorized_cents:Number(pi.amount_capturable??pi.amount??expected),top_level_capture_method:pi.capture_method,card_capture_method:cardCapture,currency},p_resulting_state:"authorized",p_payment_intent_id:pi.id,p_station_id:String(session.station_id??"")||null,p_battery_id:String(session.battery_id??"")||null,p_final_amount_chf:null,p_failure_reason:null});
  if(appendErr&&!String(appendErr.message??"").includes("IDEMPOTENCY_KEY_CONFLICT")) throw appendErr;
  const {data:after}=await admin.from("rental_orchestrator_snapshots").select("state").eq("rental_id",rentalId).maybeSingle();
  if(after?.state!=="authorized") throw new Error("ORCHESTRATOR_AUTHORIZATION_NOT_CONFIRMED");

  await admin.from("audit_logs").insert({action:"stripe.payment.authorized.gateway_clover",target:rentalId,data:{payment_intent:pi.id,event_id:rawEvent.id,authorized_cents:Number(pi.amount_capturable??pi.amount??expected),currency,top_level_capture_method:pi.capture_method,card_capture_method:cardCapture}}).then(()=>{},()=>{});
  const url=Deno.env.get("SUPABASE_URL")??""; const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
  const release=await fetch(`${url}/functions/v1/eject-after-payment`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${service}`},body:JSON.stringify({rentalSessionId:rentalId})});
  const releaseText=await release.text().catch(()=>"");
  if(!release.ok) throw new Error(`EJECT_TRIGGER_HTTP_${release.status}:${releaseText.slice(0,120)}`);
  return {handled:true,replayed:false,release_status:release.status};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST") return json({error:"METHOD_NOT_ALLOWED"},405);
  const raw=await req.text();
  const signature=req.headers.get("stripe-signature")??"";
  const base=Deno.env.get("SUPABASE_URL")??"";
  const forwarded=await fetch(`${base}/functions/v1/stripe-webhook`,{method:"POST",headers:{"content-type":"application/json","stripe-signature":signature},body:raw});
  const forwardedText=await forwarded.text();
  if(!forwarded.ok) return new Response(forwardedText,{status:forwarded.status,headers:{"content-type":forwarded.headers.get("content-type")??"application/json"}});
  let event:any=null; try{event=JSON.parse(raw);}catch{return new Response(forwardedText,{status:forwarded.status,headers:{"content-type":"application/json"}});}
  if(!["payment_intent.amount_capturable_updated","checkout.session.completed"].includes(String(event?.type??""))) return new Response(forwardedText,{status:forwarded.status,headers:{"content-type":"application/json"}});
  try{const recovery=await recoverManualCard(event);return json({received:true,forwarded:true,recovery});}catch(error){console.error("stripe-webhook-gateway recovery",error);return json({error:"MANUAL_CARD_RECOVERY_FAILED"},500);}
});