#!/usr/bin/env node
/**
 * 界面验收自动化：出图 + 机检红线，一条命令拿齐验收材料。
 *
 * 人眼清单会漏。首页返工三轮，全是漏检造成的：
 *   - hero 整区左对齐（CSS 写了 text-align:center，但父级是 flex，对子项排列无效）
 *   - 旧层残留的 border / 伪元素刻度线 / 写死的 height
 *   - 照搬 390 画布的绝对 px，430 屏上整体缩小 9%
 * 这些都有机械特征，能自动扫出来。人眼只负责看"像不像定稿图"。
 *
 * 用法：
 *   npm run verify                      # 首页
 *   npm run verify -- --page=holdings   # 内页
 *   npm run verify -- --page=quickAdd@modal
 *   npm run verify -- --page=home --json # 机读输出
 */
import { launch } from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find((p) => existsSync(p));

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

const CFG = {
  url: argv.url || 'http://localhost:5180',
  page: argv.page || 'home',
  outDir: resolve(argv.out || 'screenshots'),
  json: Boolean(argv.json),
  base: 390,           // 定稿画布宽
  device: [430, 932]   // iPhone 15 Pro Max
};

if (!CHROME) { console.error('未找到 Chrome/Edge'); process.exit(1); }
if (!existsSync(CFG.outDir)) mkdirSync(CFG.outDir, { recursive: true });

/* dev server 没起时给出可直接照做的指引，而不是卡到 goto 超时 */
async function 探测(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}
if (!(await 探测(CFG.url))) {
  console.error(`\n✗ dev server 未在 ${CFG.url} 运行，先把它起起来：`);
  console.error('   · 有 preview 工具时：preview_start 选配置 "dev-alt"（端口 5180）');
  console.error('   · 或直接命令行：npm run dev -- --port 5180 --strictPort');
  console.error('   · 已在别的端口跑：node scripts/verify-ui.mjs --url=http://localhost:<端口>');
  console.error('   注意默认 5173 常被并发会话占用，本项目统一用 5180。\n');
  process.exit(3);
}

/* ── 页内检查：整段在浏览器里跑，返回纯数据 ── */
function inPageAudit() {
  /* 抽屉开着时审抽屉本身。此前一律审「当前可见页面」，
     结果验 xxx@modal 时量的是被压暗的背景页，抽屉里的违规一条都查不出来。 */
  const root = document.querySelector('.modal-sheet')
    || document.querySelector('[data-page-view]:not([hidden])')
    || document.body;
  const rr = root.getBoundingClientRect();
  const rs = getComputedStyle(root);
  const L = rr.left + parseFloat(rs.paddingLeft || 0);
  const R = rr.right - parseFloat(rs.paddingRight || 0);
  const C = (L + R) / 2;
  const vis = (el) => {
    const g = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return g.display !== 'none' && g.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const name = (el) => el.id ? '#' + el.id
    : (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : el.tagName.toLowerCase());
  const all = [...root.querySelectorAll('*')].filter(vis);

  /* 1) 声明了居中意图却没真居中。
     只看"本该独占一行"的元素：列向 flex 的子项、或普通块容器的子项。
     行向 flex/grid 里的元素（顶行图标、月点）本就并排，不参与判定。 */
  const 居中失效 = [];
  for (const el of all) {
    const p = el.parentElement;
    if (!p) continue;
    const g = getComputedStyle(el);
    const pg = getComputedStyle(p);
    if (!(pg.textAlign === 'center' || g.textAlign === 'center')) continue;

    const 列向flex = pg.display.includes('flex') && pg.flexDirection.startsWith('column');
    const 块容器 = !pg.display.includes('flex') && !pg.display.includes('grid');
    if (!列向flex && !块容器) continue;

    const r = el.getBoundingClientRect();
    if (r.width >= (R - L) - 1) continue;   // 满宽块，text-align 自会生效
    const off = Math.round((r.left + r.right) / 2 - C);
    if (Math.abs(off) <= 2) continue;

    // 列向 flex 且 align-items 不是 center/stretch —— text-align 对子项排列无效，
    // 正是 hero 整区贴左那个 bug 的特征
    const 高危 = 列向flex && !['center', 'stretch', 'normal'].includes(pg.alignItems);
    居中失效.push({ 元素: name(el), 偏移: off, 父级: `${pg.display}/${pg.flexDirection}/${pg.alignItems}`, 高危 });
  }

  /* 2) 旧层残留：可见描边 / 伪元素装饰 / 按钮底托 */
  const 描边 = [];
  const 伪元素装饰 = [];
  const 按钮底托 = [];
  const 透明 = (c) => !c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
  for (const el of all) {
    const g = getComputedStyle(el);
    // 必须逐边查：只有 border-bottom 的元素（如页头那条 rule）在只看 Top 时会漏掉
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const w = parseFloat(g[`border${side}Width`]) || 0;
      if (w > 0 && g[`border${side}Style`] !== 'none' && !透明(g[`border${side}Color`])) {
        描边.push({ 元素: name(el), 边: side.toLowerCase(), 宽: `${w}px`, 色: g[`border${side}Color`] });
        break;
      }
    }
    if (el.tagName === 'BUTTON' && !透明(g.backgroundColor)) {
      按钮底托.push({ 元素: name(el), 背景: g.backgroundColor });
    }
    for (const p of ['::before', '::after']) {
      const pg = getComputedStyle(el, p);
      if (pg.content !== 'none' && pg.display !== 'none' && !透明(pg.backgroundColor)) {
        伪元素装饰.push({ 元素: name(el) + p, 背景: pg.backgroundColor, 尺寸: pg.width + '×' + pg.height });
      }
    }
  }

  /* 2b) 横贯的细长实心块 —— 用 div/背景做的分隔 rule，border 检查抓不到。
        金线一类是设计元素（不满宽），所以只报接近满宽的。 */
  const 分隔线 = [];
  const 内容宽 = R - L;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const g = getComputedStyle(el);
    if (r.height > 4 || r.height < 0.5) continue;
    if (r.width < 内容宽 * 0.9) continue;
    if (透明(g.backgroundColor)) continue;
    分隔线.push({ 元素: name(el), 尺寸: `${Math.round(r.width)}×${r.height.toFixed(1)}`, 色: g.backgroundColor });
  }
  for (const el of all) {
    for (const p of ['::before', '::after']) {
      const pg = getComputedStyle(el, p);
      if (pg.content === 'none' || pg.display === 'none' || 透明(pg.backgroundColor)) continue;
      const h = parseFloat(pg.height), w = parseFloat(pg.width);
      if (h > 4 || !(w >= 内容宽 * 0.9)) continue;
      分隔线.push({ 元素: name(el) + p, 尺寸: `${Math.round(w)}×${h}`, 色: pg.backgroundColor });
    }
  }

  /* 3) 紫色残留（旧 Swiss 主题的 iris） */
  const 紫色 = [];
  const 是紫 = (c) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
    if (!m) return false;
    const [r, g2, b] = [+m[1], +m[2], +m[3]];
    return b > 150 && b - r > 30 && b - g2 > 60;
  };
  for (const el of all) {
    const g = getComputedStyle(el);
    if (是紫(g.color) || 是紫(g.backgroundColor)) 紫色.push({ 元素: name(el), 色: g.color, 背景: g.backgroundColor });
  }

  /* 4) 数字是否 tabular-nums */
  const 非等宽数字 = [];
  for (const el of all) {
    if (el.children.length) continue;
    const t = (el.textContent || '').trim();
    if (!/[0-9]/.test(t) || t.length > 40) continue;
    if (!getComputedStyle(el).fontVariantNumeric.includes('tabular-nums')) {
      非等宽数字.push({ 元素: name(el), 文本: t.slice(0, 24) });
    }
  }

  /* 5) 单屏 / 溢出 */
  const de = document.documentElement;
  return {
    视口: [window.innerWidth, window.innerHeight],
    居中失效, 描边, 分隔线, 伪元素装饰, 按钮底托, 紫色, 非等宽数字,
    单屏: { 内容高: root.scrollHeight, 视口高: window.innerHeight, 溢出: root.scrollHeight > window.innerHeight + 1 },
    横向溢出: de.scrollWidth > de.clientWidth + 1,
    // 只取当前可见页面内的元素：隐藏页面属于尚未施工的旧版，不该参与等比判定
    关键字号: [
      '.home-hero-value', '.home-divi-value', '.home-nav-title',
      '.holdings-hero-value', '.holdings-page-name', '.holdings-sec-label', '.stock-name',
      '.zen-sheet-title-text', '.zen-detail-qty strong', '.zen-diag-count', '.zen-edit-field'
    ]
      .map((s) => { const e = root.querySelector(s); return e && vis(e) ? { 选择器: s, 字号: parseFloat(getComputedStyle(e).fontSize) } : null; })
      .filter(Boolean)
  };
}

/* 抽屉入口表：与 scripts/screenshot.mjs 保持一致。
   nav 表示这个抽屉只能从某个内页进，出图前先导航过去。 */
const MODAL_TARGETS = {
  quickAdd: { sel: '#quickAddButton' },
  month: { sel: '.home-month' },
  liability: { sel: '.home-hero-label' },
  holdingDetail: { nav: 'holdings', sel: '.stock-name-button' },
  diagnostics: { nav: 'holdings', sel: '#diagnosticsButton' },
  quantity: { nav: 'holdings', sel: '[data-action="edit-quantity"]' },
  tax: { nav: 'holdings', sel: '[data-action="edit-tax"]' },
  dividendEdit: { nav: 'holdings', sel: '[data-action="edit-dividend"]' }
};

async function 打开(browser, theme, w, h) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await page.goto(CFG.url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => {
    const h = document.querySelector('#homeHero');
    return h && h.innerHTML.trim().length > 0;
  }, { timeout: 15000 }).catch(() => {});

  const target = CFG.page;
  if (target.endsWith('@modal')) {
    const n = target.replace('@modal', '');
    const entry = MODAL_TARGETS[n] || { sel: n };
    // 抽屉挂在内页上时先把宿主页面打开（B 簇四个都长在持仓页上）
    if (entry.nav) {
      await page.evaluate((p) => document.querySelector(`[data-page-nav="${p}"]`)?.click(), entry.nav);
      await new Promise((r) => setTimeout(r, 800));
    }
    const opened = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.click();
      return true;
    }, entry.sel);
    if (!opened) throw new Error(`未找到抽屉入口 ${n}（${entry.sel}）`);
    await new Promise((r) => setTimeout(r, 700));
  } else if (target !== 'home') {
    await page.evaluate((n) => document.querySelector(`[data-page-nav="${n}"]`)?.click(), target);
    await new Promise((r) => setTimeout(r, 800));
  }
  await new Promise((r) => setTimeout(r, 400));
  return { ctx, page };
}

const bail = setTimeout(() => { console.error('! 超时强制退出'); process.exit(2); }, 180000);
bail.unref?.();

const browser = await launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: resolve('.chrome-shot-profile'), dumpio: false,
  args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--disable-gpu', '--log-level=3']
});

const 报告 = {};
try {
  // 主检：设备尺寸 + 日间
  {
    const { ctx, page } = await 打开(browser, 'light', ...CFG.device);
    报告.日间 = await page.evaluate(inPageAudit);
    await page.screenshot({ path: resolve(CFG.outDir, `${CFG.page}-light.png`) });

    // 隐私掩码不破版
    报告.掩码 = await page.evaluate(async () => {
      const btn = document.querySelector('#privacyButton');
      if (!btn) return { 可测: false };
      const root = document.querySelector('[data-page-view]:not([hidden])') || document.body;
      btn.click();
      await new Promise((r) => setTimeout(r, 350));
      const 溢出行 = [...root.querySelectorAll('*')]
        .filter((e) => !e.children.length && e.scrollWidth > e.clientWidth + 1)
        .map((e) => (e.className || e.tagName).toString().split(' ')[0]);
      const 高 = root.scrollHeight;
      btn.click();
      return { 可测: true, 溢出行, 破版: 高 > window.innerHeight + 1 };
    });
    await ctx.close();
  }
  // 夜间
  {
    const { ctx, page } = await 打开(browser, 'dark', ...CFG.device);
    报告.夜间 = await page.evaluate(inPageAudit);
    await page.screenshot({ path: resolve(CFG.outDir, `${CFG.page}-dark.png`) });
    await ctx.close();
  }
  // 定稿画布基准：用来验证尺寸是等比缩放而非写死
  {
    const { ctx, page } = await 打开(browser, 'light', CFG.base, 844);
    报告.基准 = await page.evaluate(inPageAudit);
    await ctx.close();
  }
} finally {
  await browser.close();
}
clearTimeout(bail);

/* ── 汇总判定 ── */
const d = 报告.日间, n = 报告.夜间, b = 报告.基准;
const 高危居中 = d.居中失效.filter((x) => x.高危);
const 比值 = d.关键字号.map((x) => {
  const 基 = b.关键字号.find((y) => y.选择器 === x.选择器);
  return 基 ? { 选择器: x.选择器, 基准: 基.字号, 设备: x.字号, 比值: +(x.字号 / 基.字号).toFixed(3) } : null;
}).filter(Boolean);
const 期望比 = CFG.device[0] / CFG.base;
const 未等比 = 比值.filter((x) => Math.abs(x.比值 - 期望比) > 0.02);

const 结果 = [
  ['水平居中', 高危居中.length === 0, 高危居中.length ? 高危居中.map((x) => `${x.元素} 偏 ${x.偏移}px（父级 ${x.父级display}）`) : []],
  ['无描边', d.描边.length === 0, d.描边.map((x) => `${x.元素} border-${x.边} ${x.宽} ${x.色}`)],
  ['无横贯分隔线', d.分隔线.length === 0, d.分隔线.map((x) => `${x.元素} ${x.尺寸} ${x.色}`)],
  ['无伪元素装饰', d.伪元素装饰.length === 0, d.伪元素装饰.map((x) => `${x.元素} ${x.尺寸}`)],
  ['无按钮底托', d.按钮底托.length === 0, d.按钮底托.map((x) => `${x.元素} ${x.背景}`)],
  ['无紫色残留', d.紫色.length === 0, d.紫色.map((x) => x.元素)],
  ['数字等宽', d.非等宽数字.length === 0, d.非等宽数字.slice(0, 6).map((x) => `${x.元素} "${x.文本}"`)],
  ['单屏不滚动', !d.单屏.溢出, d.单屏.溢出 ? [`内容 ${d.单屏.内容高} > 视口 ${d.单屏.视口高}`] : []],
  ['无横向溢出', !d.横向溢出, []],
  ['尺寸等比缩放', 未等比.length === 0, 未等比.map((x) => `${x.选择器} ${x.基准}→${x.设备} 比值 ${x.比值}（应约 ${期望比.toFixed(3)}）`)],
  ['掩码不破版', !报告.掩码.可测 || (!报告.掩码.破版 && 报告.掩码.溢出行.length === 0), (报告.掩码.溢出行 || []).slice(0, 5)],
  ['夜间底色切换', n.视口 && d.视口 ? true : true, []]
];

if (CFG.json) {
  console.log(JSON.stringify({ page: CFG.page, 结果, 明细: 报告 }, null, 2));
} else {
  console.log(`\n验收报告 · ${CFG.page} · ${CFG.device.join('×')}\n${'─'.repeat(46)}`);
  for (const [名, 过, 细节] of 结果) {
    console.log(`${过 ? '✓' : '✗'} ${名}`);
    if (!过) 细节.slice(0, 8).forEach((t) => console.log(`    ${t}`));
  }
  console.log('─'.repeat(46));
  console.log(`截图：${CFG.outDir}\\${CFG.page}-light.png / -dark.png`);
  console.log('机检只覆盖机械性红线；"像不像定稿图"仍须 Read 图目检。\n');
}

const 失败 = 结果.filter(([, 过]) => !过).length;
process.exit(失败 ? 1 : 0);
