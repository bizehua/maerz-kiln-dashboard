import { checkPwd, recompute, gidOf, json } from '../_lib/helpers.js';
// POST /api/edit {channelId, date, value, password} -> correct a single channel daily value
export async function onRequestPost({ request, env }){
  try{
    const p = await request.json();
    if (!await checkPwd(p.password, env)){
      return json({ ok:false, needAuth:true, error:'密码验证失败，请重新解锁数据修正' }, 401);
    }
    const cid = p.channelId, date = p.date;
    let val = (typeof p.value === 'string') ? parseFloat(p.value) : p.value;
    if (!cid || !date || typeof val !== 'number' || !isFinite(val)){
      return json({ ok:false, error:'参数错误（需 channelId/date/value）' }, 400);
    }
    if (val < -50 || val > 2000){
      return json({ ok:false, error:'温度值超出合理范围(-50~2000℃)' }, 400);
    }
    const txt = await env.KILN_KV.get('data');
    if (!txt) return json({ ok:false, error:'服务端无数据，请先导入' }, 404);
    const D = JSON.parse(txt);
    const arr = D.cseries[cid];
    if (!arr) return json({ ok:false, error:'通道不存在: '+cid }, 404);
    const ex = arr.find(x=>x.d===date);
    if (!ex) arr.push({ d:date, v:val }); else ex.v = val;
    arr.sort((a,b)=> a.d < b.d ? -1 : 1);
    recompute(D);
    await env.KILN_KV.put('data', JSON.stringify(D));
    const gid = gidOf(cid);
    return json({ ok:true, gid, channelId:cid, date, value:val, groupRecords:(D.gseries[gid]||[]).length });
  }catch(e){ return json({ ok:false, error:String(e) }, 500); }
}
