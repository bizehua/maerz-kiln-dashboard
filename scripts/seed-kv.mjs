// Extract KILN_DATA from data.js into seed.json, and optionally push it to the
// Cloudflare KV namespace so the live site has an initial dataset.
//   node scripts/seed-kv.mjs
// Set env vars to upload: CF_TOKEN, CF_ACCOUNT_ID, CF_NS_ID
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataJs = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const start = dataJs.indexOf('{', dataJs.indexOf('window.KILN_DATA'));
const end = dataJs.lastIndexOf('}');
if (start < 0 || end < 0) { console.error('无法解析 data.js'); process.exit(1); }
const obj = JSON.parse(dataJs.slice(start, end + 1));

const out = path.join(root, 'seed.json');
fs.writeFileSync(out, JSON.stringify(obj));
console.log('已写出 seed.json  groups=%d records=%d', obj.groups.length, obj.meta.totalRecords);

const token = process.env.CF_TOKEN;
const acct = process.env.CF_ACCOUNT_ID;
const nsId = process.env.CF_NS_ID;
if (token && acct && nsId) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${acct}/storage/kv/namespaces/${nsId}/values/data`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  });
  const txt = await res.text();
  console.log('KV PUT status=%d %s', res.status, txt);
} else {
  console.log('未设置 CF_TOKEN/CF_ACCOUNT_ID/CF_NS_ID，已跳过上传。可手动执行:');
  console.log('  wrangler kv key put data --path seed.json --namespace-id <id> --remote');
}
