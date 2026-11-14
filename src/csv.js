import { HttpError, str } from './lib.js';

export function encodeCSV(rows) {
  return '\ufeff' + rows.map(row => row.map(value => {
    let text = String(value ?? '');
    // Spreadsheet apps may execute formulas even inside quoted CSV cells.
    if (/^\s*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n') + '\r\n';
}

export function parseCSV(input) {
  const text = str(input, 'CSV 文件', 1, 200000).replace(/^\ufeff/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  const pushField = () => { row.push(field.trim()); field = ''; closed = false; };
  const pushRow = () => { pushField(); if (row.some(Boolean)) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field || closed) throw new HttpError(400, 'CSV 引号格式错误。');
      quoted = true;
    } else if (c === ',') pushField();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else { if (closed && !/\s/.test(c)) throw new HttpError(400, 'CSV 引号后存在非法字符。'); if (!closed) field += c; }
  }
  if (quoted) throw new HttpError(400, 'CSV 引号未闭合。');
  if (field || row.length || closed) pushRow();
  if (rows.length < 2 || rows.length > 201) throw new HttpError(400, 'CSV 需包含表头和 1–200 名学生，请分批导入。');
  const headers = rows.shift();
  if (new Set(headers).size !== headers.length) throw new HttpError(400, 'CSV 表头不能重复。');
  for (const key of ['real_name', 'class_name', 'student_code']) if (!headers.includes(key)) throw new HttpError(400, `CSV 缺少 ${key} 列。`);
  const seen = new Set();
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new HttpError(400, `CSV 第 ${index + 2} 行列数不正确。`);
    const data = Object.fromEntries(headers.map((key, i) => [key, values[i]]));
    const student = { real_name: str(data.real_name, '姓名'), class_name: str(data.class_name, '班级', 1, 120), student_code: str(data.student_code, '专属验证码', 8, 128), teacher_name: str(data.teacher_name || '', '教师姓名', 0, 80) };
    const identity = JSON.stringify([student.class_name, student.real_name]);
    if (seen.has(identity)) throw new HttpError(400, `CSV 第 ${index + 2} 行学生重复。`);
    seen.add(identity);
    return student;
  });
}
