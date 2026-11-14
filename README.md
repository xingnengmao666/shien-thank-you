# 师恩难忘 · 教师感恩互动网站

以绿色原校、红色新校相连的爱心感谢墙、学生专属验证码核验、真实留言审核和独立管理后台。后端只使用 **Cloudflare Workers + D1**，前端为 HTML / CSS / 原生 JavaScript，通过同源 Fetch API 读写数据。没有 Node.js 网站服务器，也没有 LocalStorage 留言或模拟业务数据。

线上首页：<https://shien-thank-you.shiqi0325.workers.dev>  
验证码领取：<https://shien-thank-you.shiqi0325.workers.dev/codeget>  
管理后台：<https://shien-thank-you.shiqi0325.workers.dev/admin>

## 开源与隐私

本项目采用 [MIT 许可证](LICENSE)，源码仓库为 <https://github.com/xingnengmao666/shien-thank-you>。开源范围是程序代码；学生和教师信息、名单、邀请码、日志、数据库、凭据及验收截图均不属于开源内容。

生产配置 `wrangler.toml` 不上传；仓库提供 `wrangler.example.toml`。旧私人报告只保留在忽略的 `.local/` 中。提交前执行 `npm run check:publish`，检查暂存内容中的已知私有信息。

## 使用方式

1. 使用初始化管理员登录 `/admin`。
2. 创建班级，添加学生或通过 CSV 导入学生名单。
3. 学生访问 `/codeget` 输入本名领取验证码；也可将名单中的验证码**单独发给本人**。
4. 学生填写姓名、班级、验证码，验证后提交 10–1000 字感谢。
5. 管理员在“留言审核”中通过或拒绝；通过的留言才会出现在中央爱心中。
6. 首页每 30 秒同步一次，页面重新可见时也会同步。

每名学生只保留一条留言，包括待审核、拒绝和隐藏状态。需要重写时由管理员删除原留言，学生重新提交。隐藏只移除公开展示，不删除记录。系统默认显示“姓氏 + 同学”，可在设置中改成匿名或全名。

### 自助领取 `/codeget`

只允许已有学生名单中的姓名领取，不自动注册学生；同名跨班时需要额外选择班级。领取生成 128 位随机验证码，原验证码失效，已签发的学生身份凭证撤销。学生端新码只在成功响应中显示一次，领取前后均提示尽快截图并复制备份；手机上完整邀请码换行显示，方便连同姓名、班级一起截图。刷新、丢失响应或关闭页面后需联系管理员，导出当前码或重置领取次数后重新领取。已有任何状态的寄语或关闭提交时不可领取。

服务端将学生记录、Cloudflare 的 `CF-Connecting-IP`、浏览器特征指纹、独立 HttpOnly 设备 Cookie 各自作为唯一限制，**任一重复即拒绝**。D1 `code_claims` 唯一约束与领取/换码/撤销凭证的 batch 事务阻止并发重复领取。去重表使用带 Secret 的 HMAC；后台留痕另保存实际 IP 和收到的浏览器指纹摘要，设备 Cookie 始终只保存 HMAC 标识。领取记录不随每天会话清理而删除；删除学生只清空关联编号，继续保留 IP、指纹和设备限制。管理员修改验证码也不会重置自助领取机会。

主管理员在“学生名单”查看当前领取次数（0 / 1 或 1 / 1），点击单个学生的“重置领取次数”并确认后，删除其当前领取限制，释放该次记录绑定的 IP、指纹和设备。历史成功/失败日志和寄语均保留，重置操作写入审计。重置本身保留现有验证码和凭证；下一次成功领取才换码并撤销旧凭证。其他学生的限制和 10 分钟限流不受影响，已有寄语、提交关闭或来源仍与其他领取记录重复时依旧不能领取。

“导出邀请码 CSV”导出当前姓名、班级、提交状态筛选范围内的**全部学生**，不受分页影响。列为 `real_name,class_name,student_code,claim_count,code_status,submission_status`，使用 UTF-8 BOM、CRLF、引号转义和电子表格公式防护。只允许主管理员下载，响应禁止缓存，导出会写入审计。CSV 包含原始邀请码和个人信息，请妥善保管、单独分发。迁移前的验证码只有哈希，无法还原，导出对应码为空并明确标注；可通过编辑学生设置新码，或重置后由学生重领。

若保留原始 CSV，可以仅为与当前核验哈希、姓名和班级全部匹配的码补齐加密副本；原始名单及生成的补齐 SQL 必须只保存在忽略的私有目录，不上传仓库。已换码的记录不得覆盖。

这是严格的一 IP 一次规则：校园、家庭、运营商共享出口会导致其他学生无法自助领取，应由管理员私下分发验证码。指纹由 User-Agent、系统、语言、屏幕、时区、硬件信息、Canvas 和 WebGL 等特征计算，可能碰撞或被隐私设置改变。Cookie 过期、清除或无痕会话也会改变设备标识。姓名、IP 和指纹不能证明真人身份，知道其他人的本名可能冒领；更换网络、设备并伪造特征也可能绕过。若需要可靠实名核验，需引入学校账号等已验证身份。

### 后台“领码记录”

主管理员登录 `/admin` 后点击“领码记录”，按填写的姓名、完整实际 IP、领取结果及时间顺序查询，每页 20 条。每次 `POST /api/student/codeget` 均记录成功、同名待选班级、重复或限流拒绝、来源/参数错误及服务错误，以及可取得的实际 Cloudflare IP、浏览器指纹 SHA-256 摘要、Cookie HMAC 标识、姓名/班级快照和时间。请求没有提供有效指纹或设备 Cookie 时明确显示缺失；格式错误的请求体可能无法读取姓名和指纹。

成功日志与发码、换码、撤销旧凭证同一 D1 事务提交，日志保存失败不会发码。日志不保存验证码、学生身份凭证、管理员会话或原始 Cookie，不因删除学生、班级或过期会话清理而消失。仅主管理员可通过 `/api/admin/codeget-logs` 查询，审核员与未登录用户均无法访问。

`0003_codeget_logs.sql` 会回填已有成功领取记录的来源 HMAC 和当前可用姓名/班级，并沿用原领取时间；旧系统没有保存实际 IP 或客户端指纹摘要，无法还原，后台标注为历史哈希记录。迁移前的失败尝试未保存，不能补回。迁移和新版部署之间仍可能产生旧版成功记录，部署后应检查 `code_claims` 是否都有对应日志并按相同回填 SQL 补齐。数据库不可用时无法保存失败日志。

首位管理员用户名默认 `admin`，密码由初始化脚本使用密码学随机数生成，**没有固定默认密码**。本机生产凭据位于 `.local/production-admin.json`，本地开发凭据位于 `.local/local-admin.json`，请妥善保管。登录后可以在后台修改密码。

## 目录

```text
public/                  用户端、后台、样式与原生 JS
  index.html             感谢墙
  admin.html             管理后台（同时提供 /admin）
  codeget.html / .js / .css  实名自助领取页（/codeget）
  app.js / admin.js       前端 API 对接
  heart.js               保持正文可读的确定性爱心行布局
  ui.js / motion.css     线性动画、便签纸纹、请求与操作加载状态
  landing.js / .css      双校园渐变主题、鼠标感应、滚动揭示寄语入口
  students-template.csv  空白名单模板
src/
  index.js               Worker 路由入口、安全响应头、过期记录清理
  routes/public.js       公开 API、学生验证、登录和安全初始化
  routes/admin.js        审核、名单、班级、设置、统计、操作日志
  security.js            密码哈希、会话、验证码哈希、限流、Origin / CSRF
  csv.js / lib.js         CSV 解析、输入验证、分页等共用函数
migrations/               初始结构、0002 去重、0003 领码留痕、0004 加密邀请码导出
scripts/                 本地密钥、生产密钥、管理员初始化
tests/                   单元测试、真实 API 测试、真实浏览器测试
wrangler.example.toml    不含生产资源标识的配置示例
ACCEPTANCE.md            脱敏后的验收摘要
AGENTS.md                更新、推送及隐私规则
```

`node_modules`、`.wrangler`、`.dev.vars`、`.local`、生产配置、名单文件、数据库及测试截图均被 `.gitignore` 排除；空白 CSV 模板为唯一 CSV 例外。静态资源只发布 `public/`，凭据文件不会上传到网站。

## 本地初始化和开发

安装 Node.js 24 LTS 或更新版本（仅用于开发工具），在项目目录运行：

```powershell
git clone https://github.com/xingnengmao666/shien-thank-you.git
cd shien-thank-you
Copy-Item wrangler.example.toml wrangler.toml
# 新实例请先创建自己的 D1，并将 database_id 填入 wrangler.toml。
git config core.hooksPath .githooks
npm ci
npm run setup:local
npm run db:local
npm run dev
```

保持开发服务运行，在第二个终端执行：

```powershell
node scripts/init-admin.mjs
```

访问 <http://127.0.0.1:8787> 和 <http://127.0.0.1:8787/admin>。`.dev.vars` 由脚本生成独立的随机 `AUTH_SECRET`、`BOOTSTRAP_TOKEN`；重复执行不会覆盖已有密钥。管理员初始化只允许执行一次，重复初始化返回错误。

本地使用 Wrangler 的真实 workerd 和 D1 本地 SQLite 数据文件，数据保存在 `.wrangler/state/`，不使用内存模拟数据库。线上与本地数据库互相独立；改变数据库 Binding ID 后需要给对应本地库重新迁移和初始化。

## CSV 学生名单

后台“学生名单 → 导入 CSV”选择 UTF-8 编码的文件。模板：`public/students-template.csv`（仅表头，不带虚构学生）。

| 列 | 含义 | 约束 |
| --- | --- | --- |
| `real_name` | 学生真实姓名 | 1–80 字 |
| `class_name` | 班级名称 | 1–120 字 |
| `student_code` | 私下发给学生的专属验证码 | 8–128 字，建议至少 16 位随机值 |
| `teacher_name` | 班级教师姓名 | 可选，最多 80 字 |

支持 UTF-8 BOM、CRLF、带逗号的引号字段和双引号转义。每批 1–200 人。不存在的班级会自动创建，已有班级的教师信息不会被导入覆盖。班级与姓名组合唯一，重复学生、损坏行、缺少验证码等会阻止**整批**保存，D1 batch 事务保证不会部分导入。修改已有学生请使用编辑功能。

验证码核验仍使用 Secret 的 HMAC-SHA-256 值。新版添加、导入、修改和自助领取的码另以 AES-GCM 加密保存供主管理员 CSV 导出，随机 IV 和核验哈希绑定防止密文被篡改或调换；普通名单接口不返回验证码或密文。旧码无法从历史哈希恢复。修改学生身份信息会使旧身份凭证失效；编辑时留空验证码会保留原验证码及密文。为防误删，班级有学生时不可删除，学生有留言时需先处理留言。

## Cloudflare 部署

上述演示站点已部署。原维护实例使用本地保留的 `wrangler.toml` 和已有 Secrets，**不要重新创建数据库或重新生成 `AUTH_SECRET`**。从公开仓库部署新实例时，复制配置示例并使用自己的 Cloudflare 账号、D1 和独立密钥。

部署全新实例时，按以下顺序进行：

### 1. 登录并创建 D1

```powershell
npx wrangler login
npx wrangler whoami
npx wrangler d1 create shien-thank-you-db
```

将命令返回的 UUID 写入 `wrangler.toml` 的 `database_id`；`binding = "DB"` 必须保持与 Worker 代码一致。部署到不同账号时请同时调整 Worker 和数据库名称。

```toml
[[d1_databases]]
binding = "DB"
database_name = "shien-thank-you-db"
database_id = "填写实际返回的 UUID"
migrations_dir = "migrations"
```

### 2. 执行迁移

```powershell
npm run db:local
npm run db:remote
```

迁移创建班级、学生、留言、管理员、审计日志及会话、限流、设置表，含外键、状态检查、唯一约束和索引。只初始化网站设置，不插入学生、留言或默认管理员。后续修改表结构请新增 Migration，不修改已在线上执行的旧迁移。

### 3. 配置 Secrets

```powershell
node scripts/prepare-secrets.mjs
npx wrangler secret bulk .local/cloudflare-secrets.json
```

生成的两个随机值通过 Wrangler 存入 Cloudflare Secrets，不写入公开源码：

- `AUTH_SECRET`：学生验证码 HMAC、邀请码导出加密派生和请求来源限流哈希密钥，至少 32 字符。
- `BOOTSTRAP_TOKEN`：一次性管理员初始化口令。

也可用 `npx wrangler secret put AUTH_SECRET`、`npx wrangler secret put BOOTSTRAP_TOKEN` 手工设置。使用手工方式初始化管理员时，初始化脚本需从 `BOOTSTRAP_TOKEN` 环境变量取得相同口令。

### 4. 部署和初始化管理员

```powershell
npm run deploy
node scripts/init-admin.mjs --remote https://你的Worker.你的子域.workers.dev
```

初始化脚本提交同源 HTTPS 请求及初始化口令，仅在数据库没有管理员时创建主管理员，将随机登录凭据保存到 `.local/production-admin.json`，终端不会打印密码。可事先设置 `$env:ADMIN_USERNAME='自定义用户名'`（3–64 字）修改初始用户名。

初始化成功后删除远程初始化口令：

```powershell
npx wrangler secret delete BOOTSTRAP_TOKEN
```

该网站的生产初始化口令已经在验收结束后删除。重复初始化被禁止，常规部署只需 `npm run deploy`，不要再次批量上传已完成用途的初始化口令。

### 5. 域名与 HTTPS

`workers_dev = true` 会提供 Cloudflare 的 `https://…workers.dev` 地址和自动 TLS。若需自定义域名，将域名接入该 Cloudflare 账号，在 Worker 的 **Settings → Domains & Routes → Add → Custom Domain** 中绑定；Cloudflare 自动配置 DNS 和 HTTPS 证书。也可在 Wrangler 中添加对应配置：

```toml
routes = [
  { pattern = "thanks.example.com", custom_domain = true }
]
```

将 `routes` 放在配置顶层。用户端与 `/api` 应使用同一域名；API 默认不允许跨域。会话 Cookie 使用 `Secure`，生产必须通过 HTTPS 访问。

### 6. 网络代理

只有网络不通时，按用户指定代理重试：

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7890'
$env:HTTP_PROXY='http://127.0.0.1:7890'
$env:NO_PROXY='127.0.0.1,localhost'
# Node.js 24+ 的初始化和 API 测试也可启用环境代理：
$env:NODE_USE_ENV_PROXY='1'
# 如果浏览器验收也需要代理：
$env:BROWSER_PROXY='http://127.0.0.1:7890'
```

本地 `127.0.0.1` 请求需要直连。终端命令中的变量只影响当前会话。

## 页面动画与便签纸张

爱心与便签墙位于首屏，左侧绿色 `#67d027` 对应原校，右侧红色 `#94070a` 对应新校。背景、心形填充与轮廓、寄语区域的双色边线在中央渐变相接。鼠标进入对应半屏时增强该侧颜色，变化采用线性过渡；感应背景设为 `pointer-events: none`，弹窗打开期间固定配色，触摸设备保持平衡双色。

寄语入口位于爱心下方，首次浏览时隐藏，随下翻进度渐显。完全显现后才允许点击和键盘进入，并保持可用。导航“写寄语”和首屏下翻提示均可用键盘直接到达入口；减少动态效果时直接显现。

参考 `normal-pages/old-news-api.js` 的毕业留言墙，便签保留纸纹、柔和的分层阴影、固定的倾斜角度、轻微胶带与悬停抬起效果，并按爱心左右位置采用浅绿或浅红纸张。查看完整留言时沿用对应纸色。新审核的便签淡入，已有便签复用 DOM 并平滑调整位置，不会每次同步都重新播放入场动画。

便签采用约 200–220px 的紧凑纸面，署名始终显示；较长正文提供“展开全文／收起全文”下拉按钮，展开后全部显示，使用 200ms 线性过渡。也可点击“单独阅读”在弹窗查看。数量增加或正文展开时，爱心与填充随实际区域的宽高同步扩展；始终使用原来的圆润心形路径，保留两瓣曲线和心尖。手机使用可读的单列或双列。悬停不再显示重复的浮窗，较长纸张保持直立，避免倾斜后遮住相邻便签。

用户端和后台的弹窗打开、关闭及遮罩使用 200ms 线性过渡；请求期间显示循环线性加载条，表单按钮显示旋转加载状态，后台查询保留旧内容并显示刷新状态。加载条不表示虚构完成百分比。身份验证步骤、提示和成功反馈也有淡入淡出。

提交成功的纸条只在本人弹窗内收起，不把待审核内容加入公开感谢墙。用户启用“减少动态效果”时，动画自动关闭，操作流程和加载提示仍可使用。

爱心红绿虚线沿原有轮廓缓慢流动，领取成功时显示绘制完成的确认印记；均使用原生 CSS 动画，并随“减少动态效果”设置关闭。

可运行 `npm run test:motion` 验证弹窗进出、关闭按钮、Esc、加载状态结束和减少动态效果；浏览器配置与 `test:browser` 相同。

`npm run test:landing` 检查首屏布局、主题颜色与鼠标感应、渐显过程及隐藏时不可交互、弹窗配色固定、键盘与触摸操作、320–768px 无横向溢出和减少动态效果。该检查读取真实 API，不写入业务数据，可用于已运营的线上站点。

`npm run test:notes` 仅在本地 D1 创建带验收标记的短文、1000 字长文和多行长文，检查紧凑预览、展开后的完整显示、键盘收起、署名、无重叠、原有心形曲线及填充同步扩大、刷新稳定以及 320/390/768px 可读性，结束后删除业务测试记录。

## API

除邀请码导出响应为 CSV 外，其他 API 响应为 JSON，错误响应为 `{ "error": "可读的错误信息" }`。所有写请求要求 `Origin` 与站点源完全相同。管理员写请求还要求 `X-CSRF-Token`，通过登录或 `GET /api/admin/me` 取得，前端仅在内存保存。会话 Cookie 由浏览器自动携带，不把密码或认证密钥保存到 LocalStorage。

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/api/site` | 首页设置与可选班级，不返回学生名单 |
| POST | `/api/student/codeget` | `{real_name,fingerprint,class_id?}`，需先访问 `/codeget` 获取设备 Cookie；首次返回新验证码，同名返回 `needs_class` |
| POST | `/api/student/verify` | `real_name`、`class_id`、`student_code` 核验，返回 1 小时凭证 |
| POST | `/api/messages` | `Authorization: Bearer 凭证` + `{content}` 提交待审核留言 |
| GET | `/api/messages` | 只返回 approved，`page` / `page_size` / `sort=stable,asc,desc` |
| POST | `/api/admin/bootstrap` | 初始化一次，需 Secret 对应的 `X-Bootstrap-Token` |
| POST | `/api/admin/login` | `{username,password}` 登录，8 小时会话 |
| GET / POST | `/api/admin/me` / `/api/admin/logout` | 当前会话 / 退出 |
| POST | `/api/admin/password` | `{current_password,new_password}` 修改密码并撤销全部会话 |
| GET | `/api/admin/messages` | 状态、姓名、班级、时间排序及分页 |
| POST | `/api/admin/messages/:id/approve` | 通过 |
| POST | `/api/admin/messages/:id/reject` | 拒绝 |
| POST | `/api/admin/messages/:id/hide` | 隐藏已通过留言 |
| DELETE | `/api/admin/messages/:id` | 删除留言 |
| GET / POST | `/api/admin/students` | 名单查询 / 添加 |
| PUT / DELETE | `/api/admin/students/:id` | 编辑 / 删除 |
| POST | `/api/admin/students/import` | `{csv: CSV文本}` 原子导入 |
| POST | `/api/admin/students/:id/reset-code-claims` | 主管理员重置单个学生当前领取次数，保留历史和寄语 |
| GET | `/api/admin/students/export` | 主管理员下载当前筛选范围全部邀请码 CSV，支持 `name` / `class_id` / `submitted` |
| GET / POST | `/api/admin/classes` | 班级及进度 / 创建 |
| GET / PUT / DELETE | `/api/admin/classes/:id` | 查询 / 编辑 / 删除 |
| GET | `/api/admin/classes/:id/stats` | 班级人数、提交数、通过数 |
| GET / PUT | `/api/admin/settings` | 网站设置读取 / 更新 |
| GET | `/api/admin/dashboard` | 学生、留言、待审核、已通过、已拒绝、已隐藏、今日统计 |
| GET | `/api/admin/audit-logs` | 操作日志分页 |
| GET | `/api/admin/codeget-logs` | 主管理员查询领码留痕，支持 `name` / `ip` / `outcome=issued,needs_class,rejected,error` / `sort` 及分页 |

普通分页每页默认 30 条，最多 100 条，后台页面每页 20 条。后台留言筛选支持 `status`、`name`、`class_id`、`sort=asc/desc`；学生筛选支持 `name`、`class_id`、`submitted=yes/no`。今日统计按 Asia/Taipei（UTC+8）计算。

## 安全与数据行为

- 密码使用独立随机盐的 PBKDF2-SHA-256（100,000 轮，符合 Workers WebCrypto 单次迭代上限）。
- 管理员随机 256 位会话令牌只以 SHA-256 值保存到 D1；Cookie 为 `HttpOnly; Secure; SameSite=Strict`，退出和改密会撤销服务端会话。
- 学生 256 位凭证同样仅以哈希值保存到 D1，不公开学生内部 ID；验证码不能只通过姓名与班级替代。
- 所有 SQL 的用户数据通过 Prepared Statements 绑定。公开状态被固定为 `approved`，任何 `status` 参数都不能绕过审核。
- 主管理员管理名单、班级、设置及日志；审核员仅允许审核、查看统计及修改自己的密码。初始账号是主管理员，当前界面不提供额外管理员创建功能。
- CSV 导入、邀请码导出、领取次数重置、审核、隐藏、删除、学生与班级修改、设置修改、登录、退出、改密均记录 `audit_logs`。
- Origin 检查、CSRF token、同源策略、防嵌入与 CSP；所有用户内容通过 `textContent` 渲染，HTML 标签只会作为普通文字显示。
- D1 原子计数限流：公开首页/留言各 120 次/分钟/IP，身份核验 15 次/10 分钟，提交和登录各 10 次/10 分钟，初始化 5 次/10 分钟。限流桶中的来源地址以 HMAC 保存；领码留痕表另保存实际 IP，仅主管理员可查。多学生共用网络时可能触发限制，可按实际学校网络调整阈值。
- 自助领码尝试 10 次/10 分钟/IP，成功领取还受管理员重置前的领取记录限制。忽略客户端提供的 `X-Forwarded-For`，使用 Cloudflare 设置的真实 IP；本地环境缺少该头时统一使用 `local` 来源。新版上线前需先执行 `npm run db:remote`，包含 `0004_exportable_codes.sql`；迁移仅增加可空列，不修改已有邀请码、领取记录或寄语。随后执行 `npm run deploy`。
- 每天台北时间 03:15 清理过期会话和限流记录，业务留言和审计日志不自动删除。
- 爱心按数据库 `display_order` 保持便签顺序，采用两瓣到心尖逐渐收窄的行布局。纸张保持紧凑可读，长文可展开；原有心形路径的轮廓与填充根据实际区域同步缩放。旋转由留言 ID 和纸张比例确定，同一数据及窗口宽度刷新后布局一致。只有数据库中已审核的留言生成便签，不用空白便签或虚构文字补满。

`AUTH_SECRET` 用于验证码 HMAC，并派生邀请码导出加密密钥，随意更换会让原码失效且旧密文无法解密。如必须轮换，需要计划重新设置并分发学生验证码。原始/导出 CSV 和数据库备份可能包含个人信息，请在可信目录保存。

## 测试

按用户要求，线下/本地测试通过后先不再进行线上测试，等待用户另行明确要求。发布时不为复验创建生产测试学生、领取邀请码或提交寄语。下面保留的线上测试配置仅供明确要求线上验收时使用。

保持本地开发服务运行并完成管理员初始化：

```powershell
npm test
npm run test:e2e
npx playwright install chromium
npm run test:browser
npm run test:motion
npm run test:landing
npm run test:codeget
npm run test:notes
```

Windows 已安装 Edge 时可省去浏览器下载：

```powershell
$env:BROWSER_CHANNEL='msedge'
npm run test:browser
```

线上测试使用独立生产凭据：

```powershell
$env:TEST_BASE_URL='https://shien-thank-you.shiqi0325.workers.dev'
npm run test:e2e
npm run test:browser
```

API 和浏览器测试**实际读写目标 D1**，使用带验收标签的临时班级/学生/留言，并在结束后删除这些业务记录、恢复网站设置。审计记录保留。请在无人同时修改网站设置时运行，不要在已运营站点无计划运行测试。浏览器测试默认验收站点无正式留言，验证从 0 到 1 的流程，截图保存在 `test-results/`。单元测试还检查 CSV 错误、密码、角色、CSRF、限流和 0–1000 条留言的确定性布局。

`npm test` 另用 SQLite 执行真实迁移和领取 SQL，验证每个唯一条件、并发、回滚、旧凭证失效、已有寄语限制、领取日志事务和权限、历史回填、重置历史保留及其他学生隔离、加密换码和 CSV 筛选/分页/历史标注。`test:codeget` 本地通过真实 Worker/D1 验证领取→截图提醒/完整手机显示→复制→后台重置/取消与 CSV 下载→同设备重领→核验→提交、重复拦截、后台日志与筛选、XSS 文本转义、动态效果及减少动态效果，并只清理该次测试的本地领取记录及日志；设置 `TEST_BASE_URL` 时自动切换为领取页与后台记录入口的只读验收，不领取生产验证码或修改生产名单，管理员登录/退出仅操作会话和操作审计。

备份线上数据可使用：

```powershell
npx wrangler d1 export DB --remote --output .local/backup.sql
```

实际测试结果、部署版本及验收限制见 `ACCEPTANCE.md`。

## 后续更新与 GitHub 推送

每次项目更新完成后，运行相关线下测试、暂存具体公开文件，执行 `npm run check:publish`，提交并推送到 `origin` 的当前分支。不要使用强制添加忽略文件或绕过提交检查。首次克隆后执行 `git config core.hooksPath .githooks` 启用提交保护。线上不再重复测试，除非用户另行明确要求；不添加自动部署工作流。
