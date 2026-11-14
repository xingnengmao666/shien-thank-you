import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
mkdirSync('.local', {recursive:true});
const path='.local/cloudflare-secrets.json';
if (existsSync(path)) console.log('保留现有生产密钥文件。');
else { writeFileSync(path, JSON.stringify({AUTH_SECRET:randomBytes(32).toString('hex'),BOOTSTRAP_TOKEN:randomBytes(32).toString('hex')},null,2)+'\n',{mode:0o600}); console.log(`已生成生产密钥：${path}。不要提交或公开。`); }
