/* 股息诊断：只回答一个问题——每只持仓的派息在增还是在减。
   2026-08-31 两次裁决：先退役仓位纪律，随后规则收敛到只剩股息增减对比，
   基本面衍生规则（FCF 覆盖 / 净利 / 负债 / 稀释 / 数据质量）一并退场。
   对比口径与股息页公告行的减派标记同源：最近一笔派息（含未来公告）
   vs 去年同期可比笔（除息日回推一年 ±75 天窗口，跨中期/末期不混比）。 */
import { computeHoldings, findPriorYearDividendOnDate, summarizeDividendOnDate, computeDividendYoyChange } from './compute.js';
import { safeNumber, formatDateLabel } from './utils.js';

/* 最近一笔太老（超过约 13 个月）说明派息节奏已断或数据缺失，
   给不出「增减」结论，归入沉底汇总而不是硬凑一条。 */
const RECENT_WINDOW_DAYS = 400;
const FLAT_EPSILON = 0.001;

/* 最近一次分派：取最大除息日，同日多笔（常规 + 特别息）汇总为一次，任一笔是公告即算公告。 */
function latestDividendEvent(holding) {
  const dividends = Array.isArray(holding.dividends) ? holding.dividends : [];
  let latest = null;
  dividends.forEach((item) => {
    const label = formatDateLabel(item && item.exDate);
    const amount = safeNumber(item && item.amountPerShare, 0);
    if (!label || amount <= 0) return;
    const announced = String(item && item.status || '').trim().toLowerCase() === 'announced';
    if (!latest || label > latest.exDate) {
      latest = { exDate: label, currency: item.currency || holding.currency || '', announced };
    } else if (label === latest.exDate && announced) {
      latest.announced = true;
    }
  });
  if (!latest) return null;
  latest.summary = summarizeDividendOnDate(dividends, latest.exDate, latest.currency);
  return latest.summary.total > 0 ? latest : null;
}

export function getDividendChangeReview() {
  const summary = computeHoldings();
  const cutoff = formatDateLabel(new Date(Date.now() - RECENT_WINDOW_DAYS * 86400000).toISOString());
  const cuts = [];
  const raises = [];
  let flatCount = 0;
  let unratedCount = 0;

  summary.holdings.forEach((holding) => {
    if (safeNumber(holding.quantity, 0) <= 0) return;
    const latest = latestDividendEvent(holding);
    if (!latest || latest.exDate < cutoff) { unratedCount += 1; return; }
    const prior = findPriorYearDividendOnDate(holding.dividends, latest.exDate, latest.currency);
    const change = computeDividendYoyChange(latest.summary, prior);
    if (change === null) { unratedCount += 1; return; }
    if (Math.abs(change) <= FLAT_EPSILON) { flatCount += 1; return; }
    // 两侧都有类型信息时细则里给常规部分，另报特别息；否则给总额（与同比基准一致）
    const useRegular = latest.summary.typed && prior.typed;
    (change < 0 ? cuts : raises).push({
      symbol: holding.symbol,
      name: holding.name || holding.symbol,
      change,
      amountPerShare: useRegular ? latest.summary.regular : latest.summary.total,
      priorPerShare: useRegular ? prior.regular : prior.total,
      specialPerShare: useRegular ? Math.max(0, latest.summary.total - latest.summary.regular) : 0,
      currency: latest.currency,
      exDate: latest.exDate,
      announced: latest.announced
    });
  });

  const byMagnitude = (a, b) => Math.abs(b.change) - Math.abs(a.change) || a.name.localeCompare(b.name, 'zh-CN');
  cuts.sort(byMagnitude);
  raises.sort(byMagnitude);
  return { cuts, raises, flatCount, unratedCount };
}
