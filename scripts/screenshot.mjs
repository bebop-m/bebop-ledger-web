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
  both: Boolean(argv.both)
};

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('未找到 Chrome/Edge。用 --exec=<路径> 指定，或安装 Chrome。');
  process.exit(1);
}

if (!existsSync(CFG.outDir)) mkdirSync(CFG.outDir, { recursive: true });

async function shoot(browser, theme) {
  const page = await browser.newPage();
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

  if (CFG.nav) {
    await page.click(`[data-page-nav="${CFG.nav}"]`);
    await new Promise((r) => setTimeout(r, 600));
  }
  if (CFG.modal) {
    await page.evaluate((name) => {
      const map = {
        quickAdd: '#quickAddButton',
        month: '.home-month',
        liability: '.home-hero-label'
      };
      document.querySelector(map[name] || name)?.click();
    }, CFG.modal);
    await new Promise((r) => setTimeout(r, 600));
  }
  await new Promise((r) => setTimeout(r, 400)); // 让入场动画落定

  const parts = ['home', CFG.nav, CFG.modal, theme, `${CFG.width}x${CFG.height}`].filter(Boolean);
  const file = resolve(CFG.outDir, `${parts.join('-')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  await page.close();
  console.log(`✓ ${file}`);
  return file;
}

const browser = await launch({
  executablePath: argv.exec || chrome,
  headless: 'new',
  // 独立临时 profile：不碰用户 Chrome 的配置、扩展与登录态
  userDataDir: resolve('.chrome-shot-profile'),
  args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars']
});

try {
  if (CFG.both) {
    await shoot(browser, 'light');
    await shoot(browser, 'dark');
  } else {
    await shoot(browser, CFG.theme);
  }
} finally {
  await browser.close();
}
