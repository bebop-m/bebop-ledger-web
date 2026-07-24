#!/usr/bin/env node
/**
 * 用系统已装的 Chrome 无头截图，绕开预览面板。
 *
 * 预览面板会把页面交给外部浏览器打开（卡片上写 "Opened in Browser"），
 * 面板自身 visibilityState 恒为 hidden、不合成帧，截图必然超时。
 * 这里用 puppeteer-core 驱动一个**独立的** Chrome 实例（临时 profile，
 * 不读写用户的 Chrome 配置，不影响已装的扩展与登录态）。
 *
 * 用法：
 *   node scripts/screenshot.mjs                          # 首页，日间，430x932
 *   node scripts/screenshot.mjs --theme=dark             # 夜间
 *   node scripts/screenshot.mjs --nav=holdings           # 先点进持仓页再截
 *   node scripts/screenshot.mjs --modal=quickAdd         # 打开某个抽屉再截
 *   node scripts/screenshot.mjs --width=390 --height=844 # 定稿画布尺寸
 *   node scripts/screenshot.mjs --both                   # 日夜各一张
 *   node scripts/screenshot.mjs --shots=home,holdings:dark,quickAdd@modal
 *                                                        # 一次启动批量出图
 *
 * 批量优先：每次启动/退出 Chrome 都是一次进程与管道往返，串联多条命令时
 * 更容易撞上外层工具的结果回传故障。要多张图就用 --shots 一次跑完。
 */
import { launch } from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

const CFG = {
  url: argv.url || 'http://localhost:5180',
  width: Number(argv.width || 430),      // iPhone 15 Pro Max 逻辑宽
  height: Number(argv.height || 932),
  dpr: Number(argv.dpr || 2),
  theme: argv.theme === 'dark' ? 'dark' : 'light',
  nav: argv.nav || '',                   // data-page-nav 的值
  modal: argv.modal || '',               // 触发某个抽屉
  outDir: resolve(argv.out || 'screenshots'),
  both: Boolean(argv.both),
  shots: argv.shots || '',
  statusbar: Boolean(argv.statusbar)
};

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('未找到 Chrome/Edge。用 --exec=<路径> 指定，或安装 Chrome。');
  process.exit(1);
}

if (!existsSync(CFG.outDir)) mkdirSync(CFG.outDir, { recursive: true });

/* dev server 没起时直说，别让它卡到 goto 超时 */
try {
  const r = await fetch(CFG.url, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(String(r.status));
} catch {
  console.error(`\n✗ dev server 未在 ${CFG.url} 运行。`);
  console.error('   preview_start 选 "dev-alt"（5180），或 npm run dev -- --port 5180 --strictPort');
  console.error('   跑在别的端口就加 --url=http://localhost:<端口>\n');
  process.exit(3);
}

/* 抽屉入口表。有的抽屉只能从内页进（B 簇四个都长在持仓页上），
   所以入口除了选择器还要记它挂在哪一页，出图时先导航再点。 */
const MODAL_TARGETS = {
  quickAdd: { sel: '#quickAddButton' },
  month: { sel: '.home-month' },
  liability: { sel: '.home-hero-label' },
  holdingDetail: { nav: 'holdings', sel: '.stock-name-button' },
  diagnostics: { nav: 'holdings', sel: '#diagnosticsButton' },
  quantity: { nav: 'holdings', sel: '[data-action="edit-quantity"]' },
  tax: { nav: 'holdings', sel: '[data-action="edit-tax"]' },
  dividendEdit: { nav: 'holdings', sel: '[data-action="edit-dividend"]' },
  monthDetail: { nav: 'dividends', sel: '.divi-ym.has-pay' },
  dividendReceipt: { nav: 'dividends', sel: '.divi-ym.has-pay', then: '.zen-md-row.is-clickable' }
};

async function shoot(browser, theme, nav = CFG.nav, modal = CFG.modal) {
  // 每张图用独立上下文：应用会记住上次停留的页面，
  // 共用 profile 时后一张的背景会是前一张的页面
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({
    width: CFG.width,
    height: CFG.height,
    deviceScaleFactor: CFG.dpr,
    isMobile: true,
    hasTouch: true
  });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await page.goto(CFG.url, { waitUntil: 'networkidle2', timeout: 30000 });

  // 等首屏渲染出真实数据，而不是空壳
  await page.waitForFunction(
    () => document.querySelector('#homeHero') && document.querySelector('#homeHero').innerHTML.trim().length > 0,
    { timeout: 15000 }
  ).catch(() => console.warn('  ! 首屏数据等待超时，仍继续截图'));

  // 抽屉挂在内页上时，先把宿主页面打开
  if (!nav && modal && MODAL_TARGETS[modal] && MODAL_TARGETS[modal].nav) nav = MODAL_TARGETS[modal].nav;

  if (nav) {
    // 用 DOM 直接派发：page.click 要先算元素的可点击几何，
    // 无头模式下会因遮挡/视口判定间歇性抛 "not clickable"
    const ok = await page.evaluate((n) => {
      const el = document.querySelector(`[data-page-nav="${n}"]`);
      if (!el) return false;
      el.click();
      return true;
    }, nav);
    if (!ok) throw new Error(`未找到导航入口 [data-page-nav="${nav}"]`);
    await new Promise((r) => setTimeout(r, 700));
  }
  if (modal) {
    const opened = await page.evaluate((name, targets) => {
      const sel = (targets[name] && targets[name].sel) || name;
      const el = document.querySelector(sel);
      if (!el) return false;
      el.click();
      return true;
    }, modal, MODAL_TARGETS);
    if (!opened) throw new Error(`未找到抽屉入口 ${modal}`);
    await new Promise((r) => setTimeout(r, 600));
    // then 表示这个抽屉还要再往下钻一层（08-股息到账只能从 07-月明细的可点行进）
    const then = MODAL_TARGETS[modal] && MODAL_TARGETS[modal].then;
    if (then) {
      const deeper = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.click();
        return true;
      }, then);
      if (!deeper) throw new Error(`未找到二级入口 ${modal}（${then}）`);
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  await new Promise((r) => setTimeout(r, 400)); // 让入场动画落定

  /* 模拟 iPhone 状态栏。注意 apple-mobile-web-app-status-bar-style=default 时
     状态栏不透明、页面是从它**下方**开始的，所以要把内容整体下推 59pt 再在
     上方画条，而不是盖在页面上——盖上去会把 brand 压掉，得出错误结论。 */
  if (CFG.statusbar) {
    const SB = 59;
    await page.addStyleTag({
      content: `body { padding-top: ${SB}px !important; }
        body[data-active-page="home"] #homePage { min-height: calc(100dvh - ${SB}px) !important; }`
    });
    await page.evaluate((sb, dark) => {
      const bar = document.createElement('div');
      bar.style.cssText = `position:fixed;top:0;left:0;right:0;height:${sb}px;z-index:99999;
        display:flex;align-items:center;justify-content:space-between;padding:0 34px 0 38px;
        font:600 17px/1 -apple-system,"PingFang SC",sans-serif;pointer-events:none;
        color:${dark ? '#ece6d8' : '#000'};background:${dark ? '#23201b' : '#faf8f3'};`;
      bar.innerHTML = '<span>21:21</span><span style="font-size:15px;letter-spacing:2px">▮▮▮ ▰</span>';
      document.body.appendChild(bar);
    }, SB, theme === 'dark');
    await new Promise((r) => setTimeout(r, 200));
  }

  const parts = ['home', nav, modal, theme, `${CFG.width}x${CFG.height}`].filter(Boolean);
  const file = resolve(CFG.outDir, `${parts.join('-')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  await ctx.close();
  console.log(`✓ ${file}`);
  return file;
}

/* 整体兜底超时：宁可自己退出并报错，也不要把进程挂在那里让上层等 */
const HARD_TIMEOUT_MS = Number(argv.timeout || 120000);
const bail = setTimeout(() => {
  console.error(`! 超过 ${HARD_TIMEOUT_MS}ms 未完成，强制退出`);
  process.exit(2);
}, HARD_TIMEOUT_MS);
bail.unref?.();

const browser = await launch({
  executablePath: argv.exec || chrome,
  headless: 'new',
  // 独立临时 profile：不碰用户 Chrome 的配置、扩展与登录态
  userDataDir: resolve('.chrome-shot-profile'),
  dumpio: false, // 不把 Chrome 的 GPU/sandbox 噪声灌进 stdio
  args: [
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--disable-gpu', '--log-level=3', '--silent'
  ]
});

/* --shots=home,holdings:dark,quickAdd@modal
   逗号分隔；:theme 指定日夜；@modal 表示按抽屉而非导航处理 */
function parseShots(spec) {
  return String(spec).split(',').map((raw) => {
    const [target, theme = CFG.theme] = raw.trim().split(':');
    const isModal = target.endsWith('@modal');
    const name = isModal ? target.replace('@modal', '') : target;
    return {
      theme: theme === 'dark' ? 'dark' : 'light',
      nav: !isModal && name !== 'home' ? name : '',
      modal: isModal ? name : ''
    };
  });
}

let failed = 0;
/* 单张失败不拖垮整批：记下来继续，最后一次性汇报 */
async function safeShoot(...args) {
  try {
    await shoot(browser, ...args);
  } catch (err) {
    failed++;
    console.error(`✗ ${args.filter(Boolean).join('/')} — ${err.message}`);
  }
}

try {
  if (CFG.shots) {
    for (const s of parseShots(CFG.shots)) await safeShoot(s.theme, s.nav, s.modal);
  } else if (CFG.both) {
    await safeShoot('light');
    await safeShoot('dark');
  } else {
    await safeShoot(CFG.theme);
  }
} finally {
  await browser.close();
}
clearTimeout(bail);
if (failed) console.error(`${failed} 张失败`);
// 不等待任何可能悬挂的句柄，立即结束，让上层拿到干净的退出
process.exit(failed ? 1 : 0);
