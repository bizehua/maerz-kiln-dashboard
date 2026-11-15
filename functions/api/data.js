import { json } from '../_lib/helpers.js';
// GET /api/data -> return current KILN_DATA stored in KV (public; no auth required)
export async function onRequestGet({ env }){
  try{
    const v = await env.KILN_KV.get('data');
    if (!v) return json({ ok:false, error:'no-data' }, 404);
    return new Response(v, { headers:{ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' } });
  }catch(e){ return json({ ok:false, error:String(e) }, 500); }
}
