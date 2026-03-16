# 波普账本 Bopup Ledger

纯静态高股息投资组合记账工具，面向移动端优化，无需后端服务器。

## 架构

```
GitHub Actions（每日自动）
  → Python 脚本抓取价格、股息、汇率
  → 写入 data/market.json
  → 自动提交回仓库

GitHub Pages（静态托管）
  → 页面加载时读取 data/market.json
  → 合并 data/override.json 手动覆盖
  → 实时拉取腾讯行情覆盖价格
  → 所有持仓数据保存在浏览器 localStorage
```

前端零构建依赖：一个 `index.html` + 一个 `styles.css` + 一个 `app.js`。

## 功能

**资产总览**
- 持仓总金额（人民币换算）、日涨跌额与涨跌幅
- 年度税后股息总金额、综合股息率
- USD/CNY、HKD/CNY 实时汇率显示
- 负债扣减

**持仓结构**
- 核心仓 / 打工仓占比分布
- 公司占比图例列表，支持展开/折叠
- 点击核心仓或打工仓查看分仓详情（市值、股息、平均股息率）

**持仓列表**
- 每只股票显示名称、代码、实时价格、持仓市值、数量、税后股息、股息率、占比
- 三种排序方式：持仓市值、股息率、股息金额
- 股息数据状态指示（绿色已更新 / 黄色缓存 / 红色缺失 / 灰色手动覆盖）
- 点击股息率查看数据来源、最近更新时间、最近除息日

**持仓管理**
- 新增持仓（输入代码、数量、选择仓位类型）
- 左滑删除（触摸手势）
- 编辑数量、税率、每股 TTM 股息手动覆盖
- 隐私模式（一键隐藏/显示所有金额）

**数据同步**
- 云端同步（通过 GitHub API + Personal Access Token 上传持仓快照）
- 本地导入/导出 JSON 备份

**交互动画**
- 持仓卡片列表 stagger 入场动画
- 左滑删除渐变遮罩过渡
- 卡片删除退场动画（左滑淡出 + 高度收缩）
- 刷新按钮旋转加载动画
- Modal 底部弹出/关闭滑入滑出动画
- 自定义 Toast 通知（顶部浮层，自动消失）
- 自定义 Confirm 确认框（底部 sheet，替代系统原生弹窗）
- 隐私模式切换数字淡出淡入
- 排序切换列表淡出淡入 + 自动滚回顶部
- 图例展开 stagger 入场
- 核心仓/打工仓详情展开动画
- 资产总览刷新数据过渡
- 全局按钮触摸反馈（active scale）
- 消除系统 tap highlight 直角闪框

## 股息计算

以 `dividendPerShareTtm`（每股 TTM 股息）为唯一核心字段，前端实时计算：

```
股息率 = dividendPerShareTtm / 实时价格
税前年度股息 = dividendPerShareTtm × 持股数 × 汇率
税后年度股息 = 税前年度股息 × (1 - 税率)
```

股息数据优先级：

```
手动覆盖（override.json / 前端编辑）> Yahoo 每日结果 > 旧缓存 > 0
```

## 文件结构

```
├── index.html                 # 页面入口
├── styles.css                 # 样式（含响应式和动画）
├── app.js                     # 全部业务逻辑（单文件架构）
├── config.json                # 轻量配置（核心股票、过期天数等）
├── assets/
│   └── icon.svg               # 网站图标
├── data/
│   ├── market.json            # 自动更新的行情快照（价格、股息、汇率）
│   ├── override.json          # 手动股息覆盖
│   ├── portfolio.json         # 云端同步的持仓快照
│   └── watchlist.json         # 观察名单（控制后台更新范围）
├── scripts/
│   ├── update_market_data.py  # 后台数据更新脚本
│   └── requirements.txt       # Python 依赖（requests, yfinance）
└── serve.ps1                  # 本地开发服务器（PowerShell）
```

## 数据文件说明

**data/market.json** — 由 Python 脚本自动生成，不要手动编辑。包含每只股票的价格、每股 TTM 股息、股息来源、更新时间、除息日、股息状态，以及汇率。

**data/override.json** — 手动覆盖股息数据，优先级最高。格式：

```json
{
  "00700.HK": {
    "dividendPerShareTtm": 4.5,
    "reason": "manual correction",
    "updatedAt": "2026-03-15"
  }
}
```

**data/watchlist.json** — 控制后台脚本更新哪些股票。网页端新增的持仓如果需要自动更新，必须同步添加到这个文件。

**config.json** — 轻量配置：

```json
{
  "coreSymbols": ["00700.HK", "600519.SH"],
  "dividendChangeThreshold": 0.3,
  "staleDays": 7,
  "forceVerifyMonths": [3, 4, 8, 9]
}
```

## 本地预览

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

打开 `http://127.0.0.1:4173/`

## 部署

推荐使用 GitHub Pages：

1. 仓库 Settings → Pages
2. Source 选择 Deploy from a branch
3. Branch 选择 main，Folder 选择 / (root)

后台数据自动更新需要配置 GitHub Actions 工作流（`.github/workflows/update-market-data.yml`），每日运行 Python 脚本并自动提交 `data/market.json`。

## 时间标准

后端 Python 脚本以 UTC 时间写入 `market.json`。前端使用浏览器本地时区显示，在中国大陆等效于东八区。
