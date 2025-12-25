# Codex 协作指南

## 沟通规范
- **必须使用中文回答用户问题**，包括终端输出说明、总结、提示等。
- 遇到权限或网络受限时，先说明受限情况并给出可行替代方案。

## 项目结构
- 前端：`index.html`，蓝白主题后台（包含登录页 / 投放总览 / 网红管理 / 预约与流量 / 用户管理 / 店铺管理），通过 `fetch` 调用 REST API。
- 后端：`server.js`，原生 Node.js HTTP 服务，提供 `login/logout` 与 `stores/influencers/bookings/traffic/users/overview` 等接口，并支持 TikTok 抓取。
- 数据：`influencerStore.js` 使用 `better-sqlite3` 操作 `data/app.db`（SQLite），首次启动会尝试从 `data/bookings.json` 导入旧数据并自动建表。
- 配置：`config.js` 读取 `.env` 或 `app.config.json`（目前仅使用 `PORT`），**不要**把生产机密写入仓库。

## 本地开发
1. 进入仓库根目录 `cd /Users/su/Desktop/restaurant-bookings`。
2. 安装依赖 `npm install`（锁文件已固定）。
3. 如需自定义端口，在 `.env` 或 `app.config.json` 中写入 `PORT`。
4. 通过 `npm start` 启动静态文件与 API，浏览器访问 `http://localhost:8787`，默认账号 `admin / admin123`。

## 行为约定
- 所有业务操作需先登录获取 token；前端把 token 存在 `localStorage` 并写入 `Authorization` 头。
- `/api/stores`、`/api/influencers`、`/api/bookings`、`/api/traffic`、`/api/users`、`/api/overview` 是核心接口；新增字段时先更新 SQLite 表结构与 `influencerStore.js` 再同步前端渲染与表单。
- `POST /api/traffic/fetch` 仅做“尽力而为”的网页抓取，若因网络受限返回错误，前端应提示改为手动输入。
- `chat.html` 是占位提示，避免旧链接 404，无需再维护历史聊天逻辑。

## 代码修改准则
- 继续保持原生 HTML/JS，不引入构建型框架；若拆分静态资源需同步更新 `server.js` 的静态托管逻辑。
- 新增环境配置时统一放到 `config.js`；前端不得暴露敏感信息。
- 后端依旧使用原生 `fs`/`http`，现已依赖 `better-sqlite3`；新增第三方依赖需评估部署环境并更新文档。
- 如新增 API，请在 README 中补充说明并同步此文件。

## 测试与验证
- 前端交互通过手动浏览器体验；建议覆盖登录、筛选、弹窗提交流程。
- API 可使用 `curl -H "Authorization: Bearer <token>" http://localhost:8787/api/stores` 等命令快速验证；涉及数据库写入的改动需确认对应记录确实落入 `data/app.db`。
- 如果修改抓取逻辑或数据库迁移逻辑，请说明验证步骤（成功/失败时的提示）。

## 待办/建议
- 可考虑加入账号权限分级、操作日志及更严格的 token 失效策略。
- 若未来接入数据库或第三方服务，优先抽象数据访问层并补充迁移脚本。
