import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!existsSync('.dev.vars')) {
  writeFileSync('.dev.vars', `AUTH_SECRET=${randomBytes(32).toString('hex')}\nBOOTSTRAP_TOKEN=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  console.log('已生成 .dev.vars 本地安全密钥。此文件不要提交。');
} else console.log('保留已有 .dev.vars。');
mkdirSync('.local', { recursive: true });
