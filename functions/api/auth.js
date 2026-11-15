import { checkPwd, json } from '../_lib/helpers.js';
// POST /api/auth {password} -> verify admin password
export async function onRequestPost({ request, env }){
  try{
    const p = await request.json();
    if (await checkPwd(p.password, env)) return json({ ok:true });
    return json({ ok:false, needAuth:true, error:'密码错误' }, 401);
  }catch(e){ return json({ ok:false, error:String(e) }, 500); }
}
