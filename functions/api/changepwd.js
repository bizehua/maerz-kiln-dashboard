import { checkPwd, setPwd, json } from '../_lib/helpers.js';
// POST /api/changepwd {oldPassword, newPassword} -> change admin password (both Edit + Upload share it)
export async function onRequestPost({ request, env }){
  try{
    const p = await request.json();
    if (!await checkPwd(p.oldPassword, env)){
      return json({ ok:false, needAuth:true, error:'当前密码错误' }, 401);
    }
    const np = p.newPassword;
    if (typeof np !== 'string' || np.length < 4 || np.length > 32){
      return json({ ok:false, error:'新密码需为4~32位字符' }, 400);
    }
    await setPwd(np, env);
    return json({ ok:true });
  }catch(e){ return json({ ok:false, error:String(e) }, 500); }
}
