import { checkPwd, recompute, json } from '../_lib/helpers.js';
// POST /api/import {password, groups, cseries, ...} -> bulk merge & persist full dataset
export async function onRequestPost({ request, env }){
  try{
    const D = await request.json();
    if (!await checkPwd(D.password, env)){
      return json({ ok:false, needAuth:true, error:'密码验证失败，请重新解锁数据修正' }, 401);
    }
    // never persist the plaintext password into KV (it would leak via /api/data)
    delete D.password;
    if (!Array.isArray(D.groups) || !D.groups.length || typeof D.cseries !== 'object' || !D.cseries){
      return json({ ok:false, error:'数据格式错误（需 groups 数组与 cseries 对象）' }, 400);
    }
    D.meta = Object.assign({}, D.meta||{}, { lastEdit: new Date().toISOString() });
    recompute(D);
    await env.KILN_KV.put('data', JSON.stringify(D));
    return json({ ok:true, totalRecords:D.meta.totalRecords, groups:D.groups.length });
  }catch(e){ return json({ ok:false, error:String(e) }, 500); }
}
