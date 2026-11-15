// Shared helpers for Maerz kiln Pages Functions.
// IMPORTANT: this module exports NO `onRequest*` handler, so it is never treated as a route.
const DEFAULT_PWD = '12344321';

function toHex(buf){
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, '0');
  return s;
}
async function sha256Hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return toHex(buf);
}
// constant-time string compare (avoid trivial timing leaks)
function safeEqual(a, b){
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = new TextEncoder().encode(a), bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let r = 0;
  for (let i = 0; i < ab.length; i++) r |= ab[i] ^ bb[i];
  return r === 0;
}
function newSalt(){
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return toHex(b);
}

// load auth from KV; auto-create default password on first use
export async function loadAuth(env){
  try{
    const raw = await env.KILN_KV.get('auth');
    if (raw) return JSON.parse(raw);
  }catch(e){}
  const salt = newSalt();
  const a = { salt, hash: await sha256Hex(salt + DEFAULT_PWD), updatedAt: new Date().toISOString() };
  try{ await env.KILN_KV.put('auth', JSON.stringify(a)); }catch(e){}
  return a;
}
export async function checkPwd(password, env){
  if (typeof password !== 'string' || !password) return false;
  const a = await loadAuth(env);
  const h = await sha256Hex(a.salt + password);
  return safeEqual(a.hash, h);
}
export async function setPwd(newPassword, env){
  const a = await loadAuth(env);
  a.hash = await sha256Hex(a.salt + newPassword);
  a.updatedAt = new Date().toISOString();
  await env.KILN_KV.put('auth', JSON.stringify(a));
  return a;
}
export function gidOf(cid){ const m = cid && cid.match(/^G\d+/); return m ? m[0] : null; }

// rebuild gseries + records from cseries (source of truth) — mirrors server.js recompute()
export function recompute(D){
  const gseries = {}, records = [];
  D.groups.forEach(g=>{
    const byDay = {};
    g.chans.forEach(c=>{ (D.cseries[c.id]||[]).forEach(x=>{ (byDay[x.d]=byDay[x.d]||[]).push(x.v); }); });
    const arr = [];
    Object.keys(byDay).sort().forEach(d=>{
      const a = byDay[d];
      const m = a.reduce((s,v)=>s+v,0)/a.length;
      arr.push({ d, m:+m.toFixed(1), lo:Math.min.apply(null,a), hi:Math.max.apply(null,a), n:a.length });
    });
    gseries[g.id] = arr;
    arr.forEach(x=>records.push({d:x.d,p:g.id,m:x.m,lo:x.lo,hi:x.hi,n:x.n}));
  });
  D.gseries = gseries; D.records = records;
  D.meta = Object.assign({}, D.meta||{}, { totalRecords: records.length, lastEdit: new Date().toISOString() });
  return D;
}
export function json(obj, status){
  return new Response(JSON.stringify(obj), { status: status||200, headers:{'Content-Type':'application/json; charset=utf-8'} });
}
