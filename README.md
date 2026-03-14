# 波普账本网页端

这版网页已经切换成纯静态方案：

- 前端页面只读取 `data/market.json`
- `GitHub Actions` 每 5 分钟自动更新一次价格和汇率
- `GitHub Pages` 或其他静态托管只负责发布网页文件
- 不再依赖 Longbridge、Netlify Functions 或本地常驻服务

## 当前能力

- 资产总览
- 公司占比圆环图
- 核心仓 / 打工仓横向占比条
- 本地持仓保存
- 新增、删除
- 数量弹窗编辑
- 税率弹窗编辑
- 股息率手动覆盖
- 负债扣减总金额
- 按持仓市值 / 股息率排序
- 隐私隐藏
- Yahoo Finance 定时更新价格
- Frankfurter 定时更新汇率
- 港股 TTM 股息率自动更新
- A 股 TTM 股息率自动计算

## 关键文件

- `data/watchlist.json`
- `data/market.json`
- `scripts/update_market_data.py`
- `scripts/requirements.txt`
- `.github/workflows/update-market-data.yml`

## 架构

```text
GitHub Actions
  -> 运行 Python 脚本
  -> 从 Yahoo Finance 拉股票价格
  -> 从 Yahoo Finance 拉股息历史并计算 TTM 股息率
  -> 从 Frankfurter 拉汇率
  -> 更新 data/market.json
  -> 提交回仓库

GitHub Pages
  -> 发布 main 分支根目录静态网页
  -> 页面刷新时读取 data/market.json
```

## 本地预览

```powershell
powershell -ExecutionPolicy Bypass -File "C:\GPT CODEX\web-app\serve.ps1"
```

打开：

```text
http://127.0.0.1:4173/
```

## GitHub 自动更新

工作流会：

- 每 5 分钟运行一次
- 更新 `data/market.json`
- 自动提交最新行情文件

如果你是用 GitHub 网页手动上传文件，记得把隐藏目录 `.github` 也一起处理，不然工作流不会生效。

## GitHub Pages 发布

推荐设置：

- `Settings`
- `Pages`
- `Build and deployment`
- `Source`: `Deploy from a branch`
- `Branch`: `main`
- `Folder`: `/ (root)`

仓库里保留了 `.nojekyll`，这样 GitHub Pages 会按纯静态站点处理，不会套 Jekyll。

## 重要限制

### 观察名单限制

自动更新只覆盖 `data/watchlist.json` 里的股票。也就是说：

- 你在网页里新增了一只新股票
- 想让它也自动刷新价格
- 还需要把它补进 `data/watchlist.json`

### 数据来源

- 港股 / A 股 / 美股价格：Yahoo Finance
- 汇率：Frankfurter
- 港股 / A 股股息率：根据 Yahoo 股息历史计算最近 12 个月 TTM

### 股息率

- 港股：自动计算 TTM 股息率，也可手动覆盖
- A 股：自动计算 TTM 股息率，也可手动覆盖
- 美股：当前默认不依赖自动股息率，必要时可手动覆盖
