# 波普账本网页端

这版网页现在改成了：

- 静态网页前端
- `data/market.json` 作为行情快照
- `GitHub Actions` 每 5 分钟自动更新一次股价和汇率
- `Netlify` 或 `GitHub Pages` 只负责托管静态文件

## 当前能力

- 资产总览
- 公司占比圆环图
- 核心仓 / 打工仓横向占比条
- 本地持仓保存
- 新增持仓
- 数量弹窗编辑
- 税率弹窗编辑
- 删除持仓
- 按持仓市值 / 股息率排序
- 隐私隐藏
- 免费股价刷新（基于 AKShare 定时更新）

## 架构

```text
GitHub Actions
  -> 运行 Python 脚本
  -> 从 AKShare 拉股价
  -> 从 Frankfurter 拉汇率
  -> 生成 data/market.json
  -> 提交回仓库

静态网页
  -> 读取 data/market.json
```

## 关键文件

- `data/watchlist.json`
- `data/market.json`
- `scripts/update_market_data.py`
- `scripts/requirements.txt`
- `.github/workflows/update-market-data.yml`

## 使用说明

### 1. 本地预览

```powershell
powershell -ExecutionPolicy Bypass -File "C:\GPT CODEX\web-app\serve.ps1"
```

打开：

```text
http://127.0.0.1:4173/
```

### 2. GitHub 自动更新

GitHub Actions 工作流会：

- 每 5 分钟跑一次
- 更新 `data/market.json`
- 自动提交最新行情文件

### 3. Netlify 部署

当前版本不需要环境变量，也不需要函数。

只要部署静态文件即可。

## 重要限制

### 观察名单限制

GitHub Actions 只能更新 `data/watchlist.json` 里的股票。

也就是说：

- 如果你在网页里新增了一只新股票
- 想让它也自动刷新价格
- 还需要把这只股票补进 `data/watchlist.json`

### 港股时效

AKShare 的港股行情文档注明是 `15 分钟延时`。

### 股息率

当前这版主要自动更新股价和汇率。

股息率如果 AKShare 没有稳定来源，网页会继续保留已有值；新增股票默认可能是 `0`，后面可以再补手填入口。
