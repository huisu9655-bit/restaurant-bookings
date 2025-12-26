# 餐厅网红预约与流量登记系统

这是一个帮助多门店协调网红档案、预约排期与流量结果的轻量级后台。系统提供「投放总览 / 网红管理 / 预约与流量 / 用户管理 / 店铺管理」五个菜单，支持账号登录、蓝白风格 UI 与 TikTok 指标自动抓取。

- 前端 `index.html`：原生 JS 后台，包含登录页、蓝白主题、搜索/筛选、预约弹窗、流量登记弹窗。
- 后端 `server.js`：原生 Node.js HTTP 服务，托管静态资源并暴露 `/api/login`、`/api/logout`、`/api/stores`、`/api/influencers`、`/api/bookings`、`/api/traffic`、`/api/traffic/fetch`、`/api/users`、`/api/overview`。
- 配置 `config.js`：读取 `.env` 或 `app.config.json` 中的 `PORT`，并支持可选 PostgreSQL 连接配置（不要把生产机密提交到仓库）。
- 数据库：默认使用 `data/app.db`（SQLite）；也可通过配置切换到 PostgreSQL。首次启动若发现数据库为空，会尝试从 `data/bookings.json`（若存在）导入历史数据并自动建表。

## 功能亮点
- **投放总览**：展示预约数量、门店/达人档案、累计曝光，并列出最近的流量登记。
- **网红管理**：仅保留昵称、账号、照片（上传后转换为 Base64）、联系渠道、联系方式与备注，支持昵称搜索和卡片展示。
- **预约与流量**：右上角按钮打开新增预约弹窗；列表支持关键词/门店/时间筛选，并可就地为每条预约登记流量结果（视频发布时间、链接、观看/点赞/评论/收藏、备注）或尝试自动抓取 TikTok 指标。
- **用户管理**：维护后台登录账号，支持新增账号与重置密码；默认账号为 `admin / admin123`，建议上线后立即修改。
- **店铺管理**：只需门店名称、门店图片（上传后保存）、地址三项信息，方便在预约表单中直接引用。

## 目录结构
```
├─ data/app.db             # SQLite 数据库文件（首次运行自动创建）
├─ data/bookings.json      # 可选：旧版 JSON 备份，首次运行时会尝试导入
├─ index.html              # 蓝白主题后台界面（含登录/菜单/弹窗）
├─ influencerStore.js      # 数据层门面：按配置选择 SQLite / PostgreSQL
├─ sqliteStore.js          # SQLite 数据读写与聚合工具
├─ postgresStore.js        # PostgreSQL 数据读写与聚合工具
├─ server.js               # HTTP 服务与 REST API
├─ config.js               # 端口配置
├─ chat.html               # 旧聊天页占位，只提示返回后台
├─ package.json
└─ README.md
```

## 本地运行
1. 安装依赖
   ```bash
   npm install
   ```
2. （可选）在 `.env` 或 `app.config.json` 中写入 `PORT`。
3. 启动服务
   ```bash
   npm start
   ```
   浏览器访问 [http://localhost:8787](http://localhost:8787) 即可看到登录页（默认账号 `admin / admin123`）。登录后即可使用后台。

## PostgreSQL（可选）
默认仍使用 SQLite。如需切换到 PostgreSQL，在 `.env` 或 `app.config.json` 中配置：
```bash
DB_DRIVER=postgres
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
# 可选：需要 TLS 的托管库可开启
PG_SSL=true
# 可选：连接池大小
PG_POOL_MAX=10
```
说明：
- 首次连接 PostgreSQL 会自动建表；若表为空，会尝试从 `data/bookings.json` 导入旧数据，并创建默认账号 `admin / admin123`。
- 如需把当前 SQLite 数据迁移到 PostgreSQL，可先导出 `data/bookings.json`：
  ```bash
  node tools/export_sqlite_to_bookings_json.js
  ```
  然后再配置 `DB_DRIVER=postgres` 并启动服务，让 PG 自动导入。
- `DATABASE_URL` 属于敏感信息，建议仅放在本机 `.env`，不要提交到仓库。

## API 说明
> 所有接口除 `POST /api/login` 外均需要在请求头携带 `Authorization: Bearer <token>`。

### 认证
- `POST /api/login`：`{ "username": "admin", "password": "admin123" }` → `{ ok, token, user }`
- `POST /api/logout`：清除当前 token。

### 门店
- `GET /api/stores`：返回 `{ ok, stores }`。
- `POST /api/stores`：`{ name, address, imageData }`。
- `PUT /api/stores/:id`：更新单个门店。
- `DELETE /api/stores/:id`：若无关联预约可删除门店。

### 达人
- `GET /api/influencers`：返回 `{ ok, influencers }`。
- `POST /api/influencers` / `PUT /api/influencers/:id`：字段仅包含 `displayName/handle/avatarData/contactMethod/contactInfo/notes`。
- `DELETE /api/influencers/:id`：删除达人，若存在关联预约或流量将报错。

### 预约
- `GET /api/bookings`：支持 `store`、`q`、`startDate`、`endDate` 过滤，返回 `{ ok, filters, records, summary, stores }`。
- `POST /api/bookings`：示例
  ```json
  {
    "storeId": "store-mlzg",
    "influencerId": "inf-nghami",
    "sourceType": "预约",
    "visitDate": "2024-03-08",
    "visitWindow": "周五 18:00",
    "serviceDetail": "突出新品套餐",
    "videoRights": "TikTok 短视频 1 支",
    "postDate": "2024-03-10",
    "budgetMillionVND": 120,
    "notes": "到店需要布置霓虹灯"
  }
  ```
  至少需要 `storeId`、`influencerId`、`visitDate`。
- `DELETE /api/bookings/:id`：删除预约，并清理关联流量记录。

### 流量
- `GET /api/traffic`：返回 `{ ok, logs }`，按登记时间倒序。
- `POST /api/traffic`：`{ bookingId, postDate, videoLink, views, likes, comments, shares, note }`。
- `PUT /api/traffic/:id`：更新已有流量记录（字段同上）。
- `POST /api/traffic/fetch`：`{ videoLink }`，尝试抓取 TikTok 页面的 `playCount/diggCount/...`。
- **自动刷新**：服务启动后会在每天 08:00（本地时区）自动尝试抓取最近 100 条有视频链接的流量记录，更新观看/点赞/评论/收藏等指标；抓取失败会跳过并记录日志。

### 总览
- `GET /api/overview`：返回 `{ ok, data }`，包含预约汇总、累计曝光、门店/达人数量、最新流量记录。

### 用户
- `GET /api/users`：返回 `{ ok, users }`（不含密码）。
- `POST /api/users`：`{ username, password }` 创建账号。
- `PUT /api/users/:id`：`{ password }` 重置密码。

> **提示**：预算字段以“万 VND”为单位，流量指标填入真实数值，前端会自动格式化展示。

## 数据库存储
- SQLite 文件位于 `data/app.db`，使用 `better-sqlite3` 同步读写；也可切换为 PostgreSQL（`pg`）。
- 表结构包括：
  - `stores`：门店信息（名称、地址、图片）。
  - `influencers`：达人档案（昵称、账号、照片、联系方式、备注）。
  - `bookings`：预约记录（关联门店与达人、到访时间、权益、预算等）。
  - `traffic_logs`：流量登记（关联预约或达人、视频链接及各项指标）。
  - `users`：后台账号（用户名、角色、密码哈希）。
- 若 `data/bookings.json` 存在，首次启动且数据库为空时会自动导入其内容；之后所有数据均直接写入当前数据库。

## 其它说明
- 旧版翻译/聊天室功能已完全移除；`chat.html` 仅提示用户返回后台主页。
- `app.config.json` 可用于覆盖端口号；生产部署前建议将 `data/bookings.json` 替换为数据库或其它持久化存储，并在 API 层增加更严格的鉴权与操作日志。
- 自动抓取依赖 TikTok Web 页面的公开脚本，如遇网络或地区限制将返回友好提示，可改为手动填数。
