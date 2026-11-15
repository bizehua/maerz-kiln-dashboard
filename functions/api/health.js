import { json } from '../_lib/helpers.js';
// GET/POST /api/health -> backend liveness probe (used by the frontend to detect a backend)
export async function onRequestGet(){ return json({ ok:true, ts: Date.now() }); }
export async function onRequestPost(){ return json({ ok:true, ts: Date.now() }); }
