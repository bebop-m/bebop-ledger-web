/* 持仓诊断：只输出需要处理的异常，不生成综合评分。 */
import { computeHoldings } from './compute.js';
import {
  getCompanyFundamentals,
  getCompanyReturnModel,
  getFundamentalsCompanyCount,
  getFundamentalsMeta
} from './fundamentals.js';
import { safeNumber } from './utils.js';

const INCOME_USUAL_MAX = 0.05;
const INCOME_HARD_MAX = 0.10;
const MATERIAL_DECLINE = -0.10;

function isValue(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function fullYearRows(company, currentYear) {
  return (Array.isArray(company && company.years) ? company.years : [])
    .filter((row) => row && safeNumber(row.year, 0) > 0 && row.year < currentYear)
    .slice()
    .sort((a, b) => a.year - b.year);
}

function regularDividend(row) {
  return Math.max(0, safeNumber(row && row.dividendPerShare, 0) - safeNumber(row && row.specialDividendPerShare, 0));
}

function percent(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function ratio(value) {
  return `${Number(value).toFixed(2)} 倍`;
}

function makeItem(severity, holding, title, evidence, source, key) {
  return {
    severity,
    symbol: holding.symbol,
    name: holding.name || holding.symbol,
    weight: safeNumber(holding.holdingWeight, 0),
    title,
    evidence,
    source,
    key: `${holding.symbol}|${key || title}`
  };
}

function latestPair(rows, key) {
  const available = rows.filter((row) => isValue(row[key]));
  if (available.length < 2) return null;
  return { previous: available[available.length - 2], latest: available[available.length - 1] };
}

function addPositionDiagnostics(items, holding, source) {
  if (holding.bucket !== 'income') return;
  const assetWeight = holding.totalAssetWeight === null ? holding.holdingWeight : holding.totalAssetWeight;
  if (assetWeight > INCOME_HARD_MAX) {
    items.push(makeItem('critical', holding, '打工仓超过 10% 上限',
      `当前占总资产 ${percent(assetWeight)}，超过策略硬上限 ${percent(INCOME_HARD_MAX, 0)}`, source, 'income-hard-max'));
  } else if (assetWeight > INCOME_USUAL_MAX) {
    items.push(makeItem('attention', holding, '打工仓高于常规区间',
      `当前占总资产 ${percent(assetWeight)}，常规仓位为 2%–5%`, source, 'income-usual-max'));
  }
}

function addDividendDiagnostics(items, holding, rows, source, currentYear) {
  if (holding.bucket !== 'income') return;
  const dividendRows = rows.filter((row) => regularDividend(row) > 0);
  const latestDividend = dividendRows[dividendRows.length - 1] || null;
  if (!latestDividend || latestDividend.year < currentYear - 2) {
    items.push(makeItem('critical', holding, '近两年没有常规股息',
      latestDividend ? `最近一次常规派息来自 ${latestDividend.year} 财年` : '自动基本面没有找到常规派息记录', source, 'income-no-dividend'));
    return;
  }
  if (dividendRows.length >= 2) {
    const previous = dividendRows[dividendRows.length - 2];
    const change = regularDividend(latestDividend) / regularDividend(previous) - 1;
    if (change < 0) {
      items.push(makeItem(change <= -0.20 ? 'critical' : 'attention', holding, '常规股息同比下降',
        `${latestDividend.year} 财年下降 ${percent(Math.abs(change))}`, source, 'dividend-cut'));
    }
  }
  const coverageRows = rows.filter((row) => isValue(row.fcfDividendCoverage));
  const coverage = coverageRows[coverageRows.length - 1];
  if (coverage && Number(coverage.fcfDividendCoverage) < 1) {
    items.push(makeItem('critical', holding, '自由现金流不能覆盖股息',
      `${coverage.year} 财年覆盖 ${ratio(coverage.fcfDividendCoverage)}`, source, 'fcf-coverage'));
  } else if (coverage && Number(coverage.fcfDividendCoverage) < 1.2) {
    items.push(makeItem('attention', holding, '股息现金覆盖偏紧',
      `${coverage.year} 财年覆盖 ${ratio(coverage.fcfDividendCoverage)}`, source, 'fcf-coverage-thin'));
  }
}

function addBusinessDiagnostics(items, holding, rows, source) {
  const netPair = latestPair(rows, 'netIncome');
  let hasNetIncomeDecline = false;
  if (netPair && Number(netPair.previous.netIncome) > 0) {
    const change = Number(netPair.latest.netIncome) / Number(netPair.previous.netIncome) - 1;
    if (change <= MATERIAL_DECLINE) {
      hasNetIncomeDecline = true;
      items.push(makeItem(change <= -0.30 ? 'critical' : 'attention', holding, '净利润明显下降',
        `${netPair.latest.year} 财年同比下降 ${percent(Math.abs(change))}`, source, 'net-income-decline'));
    }
  }
  const epsPair = latestPair(rows, 'eps');
  if (epsPair && Number(epsPair.previous.eps) > 0) {
    const change = Number(epsPair.latest.eps) / Number(epsPair.previous.eps) - 1;
    // 净利润与 EPS 同向下降时只报净利润，避免同一经营变化重复占两行。
    if (change <= MATERIAL_DECLINE && !hasNetIncomeDecline) {
      items.push(makeItem('attention', holding, 'EPS 明显下降',
        `${epsPair.latest.year} 财年同比下降 ${percent(Math.abs(change))}`, source, 'eps-decline'));
    }
  }
  const fcfRows = rows.filter((row) => isValue(row.fcf));
  if (fcfRows.length >= 2 && Number(fcfRows[fcfRows.length - 1].fcf) < 0 && Number(fcfRows[fcfRows.length - 2].fcf) < 0) {
    items.push(makeItem('critical', holding, '自由现金流连续两年为负',
      `${fcfRows[fcfRows.length - 2].year}–${fcfRows[fcfRows.length - 1].year} 财年`, source, 'negative-fcf'));
  }
  const debtRows = rows.filter((row) => isValue(row.debtRatio));
  if (debtRows.length >= 3) {
    const latest = debtRows[debtRows.length - 1];
    const base = debtRows[debtRows.length - 3];
    const increase = Number(latest.debtRatio) - Number(base.debtRatio);
    if (increase >= 0.10) {
      items.push(makeItem('attention', holding, '负债率两年明显上升',
        `${base.year} ${percent(base.debtRatio)} → ${latest.year} ${percent(latest.debtRatio)}`, source, 'debt-rise'));
    }
  }
}

function addModelDiagnostics(items, holding, model, source) {
  if (!model) {
    items.push(makeItem('data', holding, '经营回报暂不可计算', '缺少完整价格或财务数据', source, 'model-missing'));
    return;
  }
  if (model.netBuybackYield !== null && model.netBuybackYield <= -0.01) {
    items.push(makeItem(model.netBuybackYield <= -0.03 ? 'critical' : 'attention', holding, '总股本持续稀释',
      `近 ${model.buybackSpan} 年年化稀释 ${percent(Math.abs(model.netBuybackYield))}`, source, 'share-dilution'));
  }
  // 最近一年经营反转已由上方盈利规则呈现；这里只报告真正的数据样本不足。
  if (model.confidence === 'low' && model.growthSpan < 3) {
    items.push(makeItem('data', holding, '长期增速置信度低',
      model.confidenceReason || '历史年数不足或最近一年出现方向反转', source, 'model-low-confidence'));
  }
}

export function getPortfolioDiagnostics() {
  const summary = computeHoldings();
  const meta = getFundamentalsMeta();
  const currentYear = new Date().getFullYear();
  const ready = getFundamentalsCompanyCount() > 0;
  const source = meta.updatedAt
    ? `自动基本面 · 更新 ${String(meta.updatedAt).slice(0, 10)}`
    : '自动基本面';
  const items = [];

  summary.holdings.forEach((holding) => {
    addPositionDiagnostics(items, holding, '当前持仓');
    const company = getCompanyFundamentals(holding.symbol);
    if (!company) {
      if (ready) items.push(makeItem('data', holding, '缺少公司基本面', '自动数据源尚未覆盖该证券', source, 'company-missing'));
      return;
    }
    const rows = fullYearRows(company, currentYear);
    const latestYear = rows.reduce((max, row) => Math.max(max, safeNumber(row.year, 0)), 0);
    if (!latestYear || latestYear < currentYear - 1) {
      items.push(makeItem('data', holding, '基本面数据已过期',
        latestYear ? `最新完整财年为 ${latestYear}` : '没有完整年度财务数据', source, 'stale-fundamentals'));
    }
    addDividendDiagnostics(items, holding, rows, source, currentYear);
    addBusinessDiagnostics(items, holding, rows, source);
    addModelDiagnostics(items, holding, getCompanyReturnModel(holding.symbol), source);
  });

  const severityOrder = { critical: 0, attention: 1, data: 2 };
  const unique = items.filter((item, index, rows) => rows.findIndex((other) => other.key === item.key) === index)
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.weight - a.weight || a.name.localeCompare(b.name, 'zh-CN'));
  return {
    ready,
    items: unique,
    critical: unique.filter((item) => item.severity === 'critical'),
    attention: unique.filter((item) => item.severity === 'attention'),
    data: unique.filter((item) => item.severity === 'data'),
    actionableCount: unique.filter((item) => item.severity !== 'data').length,
    updatedAt: meta.updatedAt || ''
  };
}
