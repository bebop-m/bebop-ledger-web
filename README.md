# 波普账本网页版

这个目录是和微信小程序完全隔离的手机网页版本。

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
- 真实股价与汇率接口预留

## 真实数据接入

当前网页版已经预留 `/api/market` 接口，建议用：

- 股价：Longbridge OpenAPI
- 汇率：Frankfurter

### 需要的环境变量

- `LONGPORT_APP_KEY`
- `LONGPORT_APP_SECRET`
- `LONGPORT_ACCESS_TOKEN`
- `LONGPORT_REGION` 可选，常用 `hk` 或 `cn`

### 部署注意

如果你只是把静态文件拖到 Netlify Drop，静态页面可以更新，但 `Netlify Functions` 不能按源码自动准备依赖。
要让 `Longbridge` 这类函数真正工作，建议改成：

1. Git 持续部署
2. 或 Netlify CLI 手动部署

参考官方文档：
- Functions 部署：https://docs.netlify.com/build/functions/deploy/
- Site deploy：https://docs.netlify.com/deploy/create-deploys/

## 本地预览

PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File "C:\GPT CODEX\web-app\serve.ps1"
```

浏览器打开：

```text
http://127.0.0.1:4173/
```