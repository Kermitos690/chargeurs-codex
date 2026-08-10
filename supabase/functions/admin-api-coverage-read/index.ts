// admin-api-coverage-read — read-only ChargeNow coverage matrix projection.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireRoles } from "../_shared/db.ts";
const READ_ROLES=["super_admin","admin","operations_admin","operator"] as const;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async(req)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});if(req.method!=="POST")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);const db=adminClient();const userId=await requireRoles(req,db,READ_ROLES);if(!userId)return json({ok:false,error:"FORBIDDEN"},403);const{data,error}=await db.from("api_coverage").select("*").order("seq");if(error)return json({ok:false,error:"API_COVERAGE_READ_FAILED"},500);return json({ok:true,rows:data??[]});});
