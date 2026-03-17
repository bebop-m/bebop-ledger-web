# 波普账本 Bopup Ledger

一个面向移动端的纯静态股息账本。前端负责持仓管理、收益计算和展示；行情、股息和汇率通过 GitHub Actions 生成 `data/market.json`；页面本身托管在 GitHub Pages。

## 当前架构

```text
公开仓库（bebop-ledger-web）
  - 网页代码：index.html / styles.css / src/*.js（ES modules）
  - 公共数据：data/market.json / data/watchlist.json / data/override.json
  - GitHub Pages 静态部署（直接 serve 源码，无构建步骤）

私有仓库（bebop-ledger-private）
  - 个人真实持仓快照：data/portfolio.json

浏览器本地（localStorage）
  - 当前设备上的运行态持仓
  - UI 状态
  - GitHub Personal Access Token
```

## 前端模块结构

前端代码使用 ES modules 拆分为 9 个文件，由 `index.html` 中的 `<script type="module" src="./src/main.js">` 入口加载。模块依赖自底向上，无循环依赖：

```text
src/
  constants.js   ← 纯数据：常量、标签、颜色、默认持仓模板
  utils.js       ← 纯函数：格式化、股息计算、symbol 标准化、quote 合并
  state.js       ← 应用状态、DOM refs、快照持久化、toast / confirm
  compute.js     ← computeHoldings（带 generation 缓存）、公司/仓位分段
  render.js      ← 全部 DOM 渲染 / 增量 patch / 手势 / 动画
  modal.js       ← 弹窗渲染、Escape/Enter 键盘处理、保存逻辑
  network.js     ← 行情拉取、腾讯 JSONP、config 加载
  sync.js        ← GitHub 云同步、导入导出
  main.js        ← 入口：UI 初始化、事件绑定、boot()
```

依赖方向：

```text
constants  →  utils  →  state  →  compute  →  render
                                               ↑
                                    modal / network / sync
                                               ↓
                                             main（入口）
```

GitHub Pages 原生支持 ES modules，部署时直接复制 `src/` 目录，无需构建。本地开发可选用 Vite：

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # 产出 dist/（可选）
```

## 数据流

```text
Update Market Data
  -> Python 脚本抓取价格、股息、汇率
  -> 写入公开仓库 data/market.json

Deploy Pages
  -> 白名单复制：src/、assets/ 和 data/ 下三个公开文件部署到 GitHub Pages
  -> update-market-data push market.json 到 main 后自动触发（唯一路径，不重复）

前端页面
  -> 优先读取站点上的 data/market.json
  -> 合并 data/override.json 的手动股息覆盖
  -> 再用腾讯实时价格覆盖 price / previousClose
  -> 所有持仓计算都在前端完成（computeHoldings 带 generation 缓存，同一数据周期内不重复计算）
```

## 当前功能

### 持仓与收益

- 展示总市值、总股息、汇率、负债和净资产
- 展示日内盈亏金额和百分比（基于腾讯 previousClose）
- 支持核心仓 / 打工仓分组，点击可展开仓位明细
- 支持按市值、股息率、股息金额排序（折叠式排序菜单）
- 展示每只股票的价格、市值、数量、税后股息、股息率和占比
- 支持数量、税率、每股 TTM 股息手动覆盖
- 隐私模式：点击后 DOM 文本替换为 ****，F12 也看不到真实金额

### 弹窗交互

- 所有编辑弹窗支持 Escape 关闭、Enter 保存
- 弹窗打开时自动聚焦输入框
- 删除确认弹窗支持 Escape 取消

### 同步

- 当前 UI 默认只暴露一个"云同步"入口
- 第一次在新设备点击云同步时，需要输入一次 GitHub Personal Access Token
- Token 保存在浏览器 `localStorage`
- 如果本地还是模板态，云同步会先尝试从私有仓库恢复真实持仓
- 如果本地已经是真实持仓，云同步会上传到私有仓库 `data/portfolio.json`
- 如果真实持仓里出现了新的股票代码，云同步会自动把它追加进公开仓库 `data/watchlist.json`
- 追加成功后会自动触发 `Update Market Data`
- 云按钮会在后台持续工作并显示旋转动画；页面本身不锁死，可以继续使用

### 行情与股息

- 价格：腾讯实时行情优先用于前端覆盖
- 股息：由后台脚本写入 `dividendPerShareTtm`
- 股息来源状态：`yfinance` / `cache` / `manual`
- Tooltip 会显示股息来源、更新时间、最近除息日，以及抓取错误（如果有）

## 公开数据与私有数据的边界

### 公开仓库中的数据

- `data/market.json`
- `data/watchlist.json`
- `data/override.json`

这些文件会进入 GitHub Pages，任何访问站点的人都可以读取。

### 私有仓库中的数据

- `data/portfolio.json`

这个文件只放在私有仓库，不在公开仓库中，也不会部署到 GitHub Pages。

## 文件说明

### 公开仓库

```text
index.html
styles.css
config.json
src/
  constants.js
  utils.js
  state.js
  compute.js
  render.js
  modal.js
  network.js
  sync.js
  main.js
assets/
  icon.svg
data/
  market.json
  override.json
  watchlist.json
scripts/
  update_market_data.py
  requirements.txt
.github/workflows/
  update-market-data.yml
  deploy-pages.yml
package.json
vite.config.js
serve.ps1
```

### 关键文件

- `src/main.js`
  前端入口，负责 UI 初始化、事件绑定和 boot 流程。

- `src/compute.js`
  持仓计算核心，带 generation-based 缓存。所有市值、股息、权重、日内盈亏都在这里算。

- `src/network.js`
  行情数据加载：站点 market.json → GitHub API fallback → 腾讯 JSONP 实时价格。

- `src/sync.js`
  GitHub 云同步全流程：Token 管理、私有仓库读写、watchlist 追加、workflow dispatch。

- `data/market.json`
  后台自动生成的公共行情快照，包含价格、每股 TTM 股息、股息来源、更新时间、最近除息日、状态和汇率。

- `data/watchlist.json`
  公共观察名单，也是后台更新股票池。前端新增真实持仓后，云同步会自动把缺失的 symbol 追加进来。

- `data/override.json`
  手动股息覆盖，优先级高于后台抓取结果。

- `config.json`
  轻量配置文件，目前主要控制 `coreSymbols` 和 `staleDays`。

- `scripts/update_market_data.py`
  后台行情脚本。负责抓取价格、股息、汇率并写入 `data/market.json`。

### 私有仓库

```text
data/
  portfolio.json
```

- `data/portfolio.json`
  个人真实持仓快照，用于跨设备恢复和备份。

## 股息计算

前端只认 `dividendPerShareTtm` 这个核心字段：

```text
股息率 = dividendPerShareTtm / 当前价格
税前年度股息 = dividendPerShareTtm * 持股数量 * 汇率
税后年度股息 = 税前年度股息 * (1 - 税率)
```

手动覆盖优先级高于后台值。

## 本地开发

### 方式一：Vite（推荐）

```bash
npm install
npm run dev
```

打开 `http://localhost:5173/`，支持热更新。

### 方式二：静态服务器

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

打开 `http://127.0.0.1:4173/`

### 方式三：任意 HTTP 服务器

ES modules 需要通过 HTTP 加载（不能 `file://`），任何支持静态文件的 HTTP 服务器都可以：

```bash
npx serve .
# 或
python -m http.server 8080
```

## 部署

本项目使用 GitHub Actions + GitHub Pages，直接 serve 源码，无构建步骤。

### 工作流

- `update-market-data.yml`
  负责更新公开仓库里的 `data/market.json`，完成后 push 到 main

- `deploy-pages.yml`
  负责部署页面，只监听 `push` 和 `workflow_dispatch`。update-market-data push 到 main 后自动触发一次部署，不会重复

部署链路：

```text
update-market-data 完成 → push market.json → 触发 deploy-pages（唯一路径）
```

### 部署白名单

`deploy-pages.yml` 使用白名单复制，只有以下文件会进入 GitHub Pages：

```text
index.html / styles.css / config.json
src/（全部 JS 模块）
assets/（图标）
data/market.json / data/watchlist.json / data/override.json
```

`data/portfolio.json` 和其他私有文件即使不小心出现在仓库中，也不会被部署。

### 推荐的同步 Token 权限

使用 fine-grained personal access token，并只授权这两个仓库：

- `bebop-ledger-web`
- `bebop-ledger-private`

最小权限：

- `Contents: Read and write`
- `Actions: Read and write`

## 技术细节

### 性能

- `computeHoldings()` 使用 generation counter 缓存，同一数据周期内多次调用直接返回缓存结果
- DOM 更新使用增量 patch 策略：`patchSummaryView` / `patchLegendView` / `patchBucketsView` / `syncRenderedHoldingsView` 只更新变化的节点
- 持仓列表排序变更时使用 FLIP 动画（`captureHoldingPositions` → `animateHoldingReflow`）

### 安全

- `.gitignore` 明确屏蔽 `data/portfolio.json` 和 `data/portfolio_snapshot.json`，防止私有持仓被意外提交到公开仓库
- `deploy-pages.yml` 使用白名单复制，即使私有文件出现在仓库中也不会部署到 GitHub Pages
- HTML 输出统一通过 `escapeHtml()` 转义，使用单次正则 + 映射表
- 隐私模式在 JS 层面替换 DOM 文本为 mask 值，CSS 层同时切换 `privacy-hidden` 类作为瞬时视觉遮罩
- GitHub Token 存储在 localStorage，仅当前域可访问
- Base64 编解码使用 `TextEncoder` / `TextDecoder`，不依赖已废弃的 `unescape()`

## 当前已知事实

- 页面默认模板和真实持仓是两套概念
- `watchlist.json` 是公共观察池，不是私有持仓快照
- 私有真实持仓不在公开仓库中（`.gitignore` 拦截 + 部署白名单双重保障）
- `Update Market Data` push 到 main 后触发 deploy，单条链路，不重复
- 如果公开仓库历史 commit 中残留过 `portfolio.json`，需要用 `git filter-repo` 彻底清除
- 腾讯实时行情通过 JSONP script 注入获取，存在潜在的 CDN 安全风险，但目前没有更好的免费替代方案
