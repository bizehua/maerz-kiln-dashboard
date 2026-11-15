// Maerz kiln dashboard — static server + data-correction write API (no external deps)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(ROOT, 'data.js');
const AUTH_FILE = path.join(ROOT, '.auth.json');
const DEFAULT_PWD = '12344321';

// ---- admin password (salted SHA-256, stored in .auth.json; dotfile = never served) ----
function loadAuth(){
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); }
  catch(e){
    const salt = crypto.randomBytes(8).toString('hex');
    const a = { salt, hash: crypto.createHash('sha256').update(salt + DEFAULT_PWD).digest('hex'), updatedAt: new Date().toISOString() };
    try { fs.writeFileSync(AUTH_FILE, JSON.stringify(a)); } catch(e2){}
    return a;
  }
}
function pwdHash(salt, pw){ return crypto.createHash('sha256').update(salt + String(pw)).digest('hex'); }
function checkPwd(pw){
  if(typeof pw !== 'string' || !pw) return false;
  const a = loadAuth();
  const h = pwdHash(a.salt, pw);
  try { return crypto.timingSafeEqual(Buffer.from(a.hash), Buffer.from(h)); }
  catch(e){ return false; }
}

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon'
};

function readData(){
  const txt = fs.readFileSync(DATA_FILE,'utf8');
  const start = txt.indexOf('{', txt.indexOf('window.KILN_DATA'));
  const end = txt.lastIndexOf('}');
  if(start<0||end<0) throw new Error('data.js 格式无法解析');
  return JSON.parse(txt.slice(start, end+1));
}
function writeData(D){
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, 'window.KILN_DATA = ' + JSON.stringify(D) + ';\n');
  fs.renameSync(tmp, DATA_FILE); // atomic replace
}
function recompute(D){
  const gseries={}, records=[];
  D.groups.forEach(g=>{
    const byDay={};
    g.chans.forEach(c=>{ (D.cseries[c.id]||[]).forEach(x=>{ (byDay[x.d]=byDay[x.d]||[]).push(x.v); }); });
    const arr=[];
    Object.keys(byDay).sort().forEach(d=>{
      const a=byDay[d];
      arr.push({ d, m:+(a.reduce((s,v)=>s+v,0)/a.length).toFixed(1), lo:Math.min.apply(null,a), hi:Math.max.apply(null,a), n:a.length });
    });
    gseries[g.id]=arr;
    arr.forEach(x=>records.push({d:x.d,p:g.id,m:x.m,lo:x.lo,hi:x.hi,n:x.n}));
  });
  D.gseries=gseries; D.records=records;
  D.meta=Object.assign({}, D.meta||{}, { totalRecords:records.length, lastEdit:new Date().toISOString() });
  return D;
}
function gidOf(cid){ const m=cid && cid.match(/^G\d+/); return m?m[0]:null; }

const server = http.createServer((req,res)=>{
  // ---- API: health check (Render) ----
  if(req.method==='GET' && req.url==='/api/health'){
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({ok:true, ts:Date.now()}));
  }
  // ---- API: verify admin password ----
  if(req.method==='POST' && req.url==='/api/auth'){
    let body='', size=0;
    req.on('data', c=>{ size+=c.length; if(size>1e5){ req.destroy(); } else body+=c; });
    req.on('end', ()=>{
      try{
        const p = JSON.parse(body||'{}');
        if(checkPwd(p.password)){
          res.writeHead(200,{'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:true}));
        }else{
          res.writeHead(401,{'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:false, needAuth:true, error:'密码错误'}));
        }
      }catch(e){
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, error:String(e && e.message || e)}));
      }
    });
    return;
  }

  // ---- API: change admin password (requires current password) ----
  if(req.method==='POST' && req.url==='/api/changepwd'){
    let body='', size=0;
    req.on('data', c=>{ size+=c.length; if(size>1e5){ req.destroy(); } else body+=c; });
    req.on('end', ()=>{
      try{
        const p = JSON.parse(body||'{}');
        if(!checkPwd(p.oldPassword)){
          res.writeHead(401,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ok:false, needAuth:true, error:'当前密码错误'}));
        }
        const np = p.newPassword;
        if(typeof np!=='string' || np.length<4 || np.length>32){
          res.writeHead(400,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ok:false, error:'新密码需为4~32位字符'}));
        }
        const a = loadAuth();
        a.hash = pwdHash(a.salt, np);
        a.updatedAt = new Date().toISOString();
        fs.writeFileSync(AUTH_FILE, JSON.stringify(a));
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true}));
      }catch(e){
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, error:String(e && e.message || e)}));
      }
    });
    return;
  }

  // ---- API: correct a channel daily value (admin password required) ----
  if(req.method==='POST' && req.url==='/api/edit'){
    let body='', size=0;
    req.on('data', c=>{ size+=c.length; if(size>1e6){ req.destroy(); } else body+=c; });
    req.on('end', ()=>{
      try{
        const p = JSON.parse(body||'{}');
        if(!checkPwd(p.password)){
          res.writeHead(401,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ok:false, needAuth:true, error:'密码验证失败，请重新解锁数据修正'}));
        }
        const cid = p.channelId, date = p.date;
        let val = (typeof p.value==='string')? parseFloat(p.value) : p.value;
        if(!cid || !date || typeof val!=='number' || !isFinite(val)){
          res.writeHead(400,{'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:false,error:'参数错误（需 channelId/date/value）'}));
        }
        if(val < -50 || val > 2000){
          res.writeHead(400,{'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:false,error:'温度值超出合理范围(-50~2000℃)'}));
        }
        const D = readData();
        const arr = D.cseries[cid];
        if(!arr){ res.writeHead(404,{'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:false,error:'通道不存在: '+cid})); }
        const ex = arr.find(x=>x.d===date);
        if(!ex) arr.push({d:date, v:val}); else ex.v = val;
        arr.sort((a,b)=> a.d<b.d?-1:1);
        recompute(D);
        writeData(D);
        const gid = gidOf(cid);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, gid, channelId:cid, date, value:val, groupRecords: (D.gseries[gid]||[]).length}));
      }catch(e){
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, error:String(e && e.message || e)}));
      }
    });
    return;
  }

  // ---- API: bulk import (merge new data and persist to server) ----
  if(req.method==='POST' && req.url==='/api/import'){
    let body='', size=0;
    req.on('data', c=>{ size+=c.length; if(size>10e6){ req.destroy(); } else body+=c; });
    req.on('end', ()=>{
      try{
        const D = JSON.parse(body||'{}');
        if(!checkPwd(D.password)){
          res.writeHead(401,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ok:false, needAuth:true, error:'密码验证失败，请重新解锁数据修正'}));
        }
        if(!Array.isArray(D.groups) || !D.groups.length || typeof D.cseries!=='object' || !D.cseries){
          res.writeHead(400,{'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:false,error:'数据格式错误（需 groups 数组与 cseries 对象）'}));
        }
        // rebuild aggregates from cseries (source of truth), so server state is always consistent
        D.meta = Object.assign({}, D.meta||{}, { lastEdit:new Date().toISOString() });
        recompute(D);
        writeData(D);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, totalRecords:D.meta.totalRecords, groups:D.groups.length}));
      }catch(e){
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, error:String(e && e.message || e)}));
      }
    });
    return;
  }

  // ---- static files (deny sensitive/server source files) ----
  let urlPath = decodeURIComponent((req.url||'/').split('?')[0]);
  if(urlPath==='/') urlPath='/index.html';
  const baseName = path.basename(urlPath);
  // never serve credentials or server source
  const DENY = new Set(['server.js','package.json','package-lock.json','.env']);
  if(baseName.startsWith('.') || DENY.has(baseName)){ res.writeHead(404); return res.end('not found'); }
  const filePath = path.join(ROOT, urlPath);
  if(filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)){ res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, buf)=>{
    if(err){ res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); return res.end('not found'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
    res.end(buf);
  });
});
server.listen(PORT, '0.0.0.0', ()=>console.log('Maerz kiln dashboard server listening on '+PORT));
