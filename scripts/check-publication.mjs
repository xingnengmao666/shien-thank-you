import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseCSV } from '../src/csv.js';

function checkFile(path, content, privateValues) {
  const template = path === 'public/students-template.csv';
  if (/^(\.local|\.wrangler|node_modules|test-results|dist)\//.test(path) || path === 'wrangler.toml'
    || /(^|\/)\.env/.test(path) || /(^|\/)\.dev\.vars/.test(path) && path !== '.dev.vars.example'
    || /\.(csv|docx?|xlsx?|pdf|db|sqlite\w*|bak|dump|pem|key|p12|pfx|sql)$/i.test(path) && !template && !/^migrations\/\d{4}_[a-z0-9_]+\.sql$/.test(path)) return 'private file type or path';
  if (content.includes('\0')) return 'binary content requires review';
  if (template && content.trim() !== 'real_name,class_name,student_code,teacher_name') return 'CSV template must contain only its header';
  if (/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) return 'credential pattern';
  if (privateValues.some(value => content.includes(value))) return 'private roster, code, credential or deployment value';
  return null;
}

if (process.argv.includes('--self-test')) {
  for (const path of ['.local/roster.csv', 'roster.csv', 'students.docx', 'data.db', 'backup.sql', 'wrangler.toml', '.dev.vars', '.dev.vars.backup', '.env.example']) assert.ok(checkFile(path, '', []));
  assert.equal(checkFile('src/index.js', 'source code', []), null);
  assert.equal(checkFile('migrations/0001_initial.sql', 'CREATE TABLE students (id INTEGER);', []), null);
  assert.equal(checkFile('.dev.vars.example', 'AUTH_SECRET=replace-with-a-random-secret', []), null);
  assert.equal(checkFile('public/students-template.csv', 'real_name,class_name,student_code,teacher_name\n', []), null);
  assert.ok(checkFile('public/students-template.csv', 'real_name,class_name,student_code,teacher_name\nprivate-row', []));
  for (const value of ['private-name', 'private-code', 'private-secret']) assert.ok(checkFile('README.md', `text ${value}`, [value]));
  assert.ok(checkFile('src/index.js', 'ghp_' + 'x'.repeat(36), []));
  assert.ok(checkFile('public/file.png', '\0binary', []));
  console.log('Publication check self-test passed.');
} else {
  const privateValues = [];
  if (existsSync('.dev.vars')) for (const line of readFileSync('.dev.vars', 'utf8').split(/\r?\n/)) {
    if (/^(AUTH_SECRET|BOOTSTRAP_TOKEN)=/.test(line)) privateValues.push(line.slice(line.indexOf('=') + 1).trim());
  }
  if (existsSync('wrangler.toml')) {
    const id = readFileSync('wrangler.toml', 'utf8').match(/database_id\s*=\s*"([a-f0-9-]{36})"/i)?.[1];
    if (id) privateValues.push(id);
  }
  if (existsSync('.local')) for (const file of readdirSync('.local')) {
    if (file.endsWith('.csv')) {
      const rows = parseCSV(readFileSync('.local/' + file, 'utf8'));
      for (const row of rows) privateValues.push(row.real_name, row.class_name, row.teacher_name, row.student_code);
    } else if (/^(cloudflare-secrets|local-admin|production-admin)\.json$/.test(file)) {
      const data = JSON.parse(readFileSync('.local/' + file, 'utf8'));
      for (const key of ['AUTH_SECRET', 'BOOTSTRAP_TOKEN', 'password']) if (data[key]) privateValues.push(data[key]);
    }
  }
  const values = [...new Set(privateValues.filter(value => typeof value === 'string' && value.length >= 2))];
  const files = execFileSync('git', ['ls-files', '--cached', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.ok(files.length, 'Stage the public project files before checking publication.');
  const failures = [];
  for (const path of files) {
    const content = execFileSync('git', ['show', ':' + path], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const reason = checkFile(path, content, values);
    if (reason) failures.push(`${path}: ${reason}`);
  }
  if (failures.length) {
    console.error('Publication blocked:\n' + failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`Publication check passed for ${files.length} staged files; no known private values or private data files found.`);
}
