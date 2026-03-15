# 波普账本网页端

这个版本采用纯静态方案：

- 前端页面读取 `data/market.json`
- 页面数据按 `market.json -> override.json -> 腾讯实时价格` 顺序合并
- `GitHub Actions` 每天自动更新一次后台数据
- `GitHub Pages` 或其他静态托管只负责发布网页文件

项目已经完成两阶段股息架构收口，当前方案以 `dividendPerShareTtm` 为核心字段，后续不要再改动核心字段和优先级规则。

## 当前能力

- 资产总览
- 公司占比圆环图
- 核心仓 / 打工仓分布
- 本地持仓保存
- 新增 / 删除持仓
- 数量弹窗编辑
- 税率弹窗编辑
- 兼容旧本地 `dividendYieldOverride` 数据（仅历史兼容）
- 负债扣减总金额
- 按持仓市值 / 股息率排序
- 隐私隐藏
- 页面加载时实时拉取腾讯价格
- 持仓行显示股息状态点与 tooltip

## 关键文件

- `data/market.json`
- `data/override.json`
- `config.json`
- `data/watchlist.json`
- `scripts/update_market_data.py`
- `scripts/requirements.txt`
- `.github/workflows/update-market-data.yml`

## 数据职责边界

### `data/market.json`

只保存自动同步结果，不混入手动覆盖。

主要内容：

- 腾讯价格快照
- 汇率
- Yahoo 每日股息结果
- 条件触发后的 EODHD 校验结果
- 每只股票的股息状态字段

核心股息字段：

- `dividendPerShareTtm`
- `dividendSource`
- `dividendUpdatedAt`
- `lastExDate`
- `dividendStatus`

可选错误字段：

- `dividendFetchError`

### `data/override.json`

只保存手动覆盖值，不参与自动生成。

用途：

- 手动修正 `dividendPerShareTtm`
- 记录手动修正原因和时间

优先级永远最高。

示例：

```json
{
  "00700.HK": {
    "dividendPerShareTtm": 4.5,
    "reason": "manual correction",
    "updatedAt": "2026-03-15"
  }
}
```

### `config.json`

只保存轻量配置，不保存行情数据。

当前字段：

- `coreSymbols`
- `dividendChangeThreshold`
- `staleDays`
- `forceVerifyMonths`

示例：

```json
{
  "coreSymbols": ["00700.HK", "600519.SH"],
  "dividendChangeThreshold": 0.3,
  "staleDays": 7,
  "forceVerifyMonths": [3, 4, 8, 9]
}
```

## 股息系统最终方案

### 核心字段

股息系统以 `dividendPerShareTtm` 为唯一核心股息字段。

不再把 `dividendYield` 作为核心存储字段或核心计算依据。

### 前端计算口径

前端统一基于以下变量实时计算：

- `dividendPerShareTtm`
- 实时价格
- 持股数
- 汇率
- 税率

公式：

```text
当前股息率 = dividendPerShareTtm / currentPrice
税前年度股息（人民币） = dividendPerShareTtm * shares * fxRate
税后年度股息（人民币） = 税前年度股息 * (1 - taxRate)
```

说明：

- 页面中的股息率会随腾讯实时价格变化而实时变化
- 年度股息按每股股息乘数量计算，不再由“价格 × 股息率”反推
- 当价格为 0、空值或异常值时，前端会安全回退，不会出现 `NaN` / `Infinity`

### 最终优先级

股息最终优先级固定为：

```text
manual override > EODHD verified result > Yahoo daily result > cached old value > 0
```

解释：

- `manual override`：来自 `override.json`
- `EODHD verified result`：只有命中校验条件且 EODHD 返回有效值时才生效
- `Yahoo daily result`：默认日常主流程
- `cached old value`：自动抓取失败时保留旧值
- `0`：最后兜底

### Yahoo / EODHD 分工

- Yahoo：每日全量更新全部观察名单
- EODHD：不是主源，只在命中条件时做轻量校验
- 没有配置 `EODHD_API_KEY` 时，系统自动跳过 EODHD，保持纯 Yahoo 模式正常运行

### EODHD 触发条件

只有满足以下任一情况时才触发 EODHD：

1. Yahoo 返回 0 或空值
2. Yahoo 相对旧缓存变化超过 `dividendChangeThreshold`
3. 股票命中 `coreSymbols`
4. 当前月份命中 `forceVerifyMonths`

### `dividendStatus` 定义

- `manual`：当前结果来自手动覆盖
- `fresh`：有有效股息数据，且 `dividendUpdatedAt` 仍在 `staleDays` 之内
- `stale`：保留旧缓存，或虽然有股息数据但更新时间已超过 `staleDays`
- `missing`：没有有效股息数据

## 自动更新架构

```text
GitHub Actions
  -> 每天运行一次 Python 脚本
  -> 从腾讯接口拉价格快照
  -> 从 Yahoo 拉股息历史并计算 TTM 每股股息
  -> 在命中条件时用 EODHD 做轻量校验
  -> 从 Frankfurter 拉汇率
  -> 更新 data/market.json
  -> 自动提交回仓库

GitHub Pages
  -> 发布静态网页
  -> 页面刷新时先读取 data/market.json
  -> 再合并 override.json
  -> 最后额外拉取一次腾讯实时价格
  -> 腾讯实时价格只覆盖 price，不会冲掉手动股息
```

## 本地预览

```powershell
powershell -ExecutionPolicy Bypass -File "C:\bebopZB-web\serve.ps1"
```

打开：

```text
http://127.0.0.1:4173/
```

## GitHub Actions

工作流文件：

- `.github/workflows/update-market-data.yml`

当前行为：

- 每天运行一次
- 更新 `data/market.json`
- 自动提交最新后台数据

如果你需要启用 EODHD 校验，在 GitHub 仓库里新增一个 Secret：

- `EODHD_API_KEY`

不配置这个 Secret 时，系统会自动跳过 EODHD，不会影响工作流正常运行。

## GitHub Pages 发布

推荐设置：

- `Settings`
- `Pages`
- `Build and deployment`
- `Source`: `Deploy from a branch`
- `Branch`: `main`
- `Folder`: `/ (root)`

## 重要限制

### 观察名单限制

自动更新只覆盖 `data/watchlist.json` 里的股票。

也就是说：

- 你在网页里新增了一只股票
- 如果想让它进入后台每日更新
- 还需要把它补进 `data/watchlist.json`

### 数据来源

- 实时价格：腾讯股票接口（前端页面加载时拉取）
- 后台价格快照：腾讯股票接口
- 汇率：Frankfurter
- 日常股息主流程：Yahoo
- 条件校验股息：EODHD（可选）

### 兼容说明

当前仍保留旧 `dividendYieldOverride` 的本地兼容层，只用于兼容旧浏览器本地数据。

它不是当前股息系统的新核心字段，也不应再继续扩展依赖。
