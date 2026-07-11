/* ── 投资纪律检查：全自动，规则来自 config.json 的 discipline 块 ──
   安静原则：没有违规时不渲染任何内容；例外持仓（exceptions）跳过全部检查。
   打工仓专属检查：仓位上限、负债率、FCF 股息覆盖；
   全仓检查：股息削减、净增发稀释。 */
import { state } from './state.js';
import { safeNumber } from './utils.js';
import { computeHoldings } from './compute.js';
import { getCompanyFundamentals, getCompanyReturnModel, getDividendYieldPercentile } from './fundamentals.js';

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

/* 完整年度行（当前年只是「至今」，不参与判断），升序。 */
function getFullYearRows(company) {
  const currentYear = new Date().getFullYear();
  return (Array.isArray(company.years) ? company.years : [])
    .filter((row) => row && safeNumber(row.year, 0) > 0 && row.year < currentYear)
    .slice()
    .sort((a, b) => a.year - b.year);
}

function regularDps(row) {
  return Math.max(0, safeNumber(row.dividendPerShare, 0) - safeNumber(row.specialDividendPerShare, 0));
}

export function getDisciplineAlerts() {
  const config = state.discipline;
  if (!config) return [];
  const summary = computeHoldings();
  const total = safeNumber(summary.totalMarketValueCny, 0);
  const alerts = [];

  summary.holdings.forEach((holding) => {
    const value = safeNumber(holding.marketValueCny, 0);
    if (value <= 0) return;
    const symbol = holding.symbol;
    if (config.exceptions.includes(symbol)) return;
    const name = holding.name || symbol;
    const isIncome = holding.bucket === 'income';

    if (isIncome && total > 0) {
      const weight = value / total;
      if (weight > config.incomeHardMax) {
        alerts.push({ severity: 'hard', symbol, name, text: `仓位 ${formatPct(weight)}，超打工仓硬上限 ${formatPct(config.incomeHardMax)}` });
      } else if (weight > config.incomeTargetMax) {
        alerts.push({ severity: 'soft', symbol, name, text: `仓位 ${formatPct(weight)}，超目标区间上限 ${formatPct(config.incomeTargetMax)}` });
      }
    }

    const company = getCompanyFundamentals(symbol);
    if (!company) return;
    const rows = getFullYearRows(company);
    if (!rows.length) return;
    const latest = rows[rows.length - 1];

    if (isIncome) {
      const debtRatio = safeNumber(latest.debtRatio, NaN);
      if (Number.isFinite(debtRatio) && debtRatio > config.debtRatioMax) {
        alerts.push({ severity: 'soft', symbol, name, text: `负债率 ${formatPct(debtRatio)}（${latest.year}），超警戒线 ${formatPct(config.debtRatioMax)}` });
      }
      const coverage = safeNumber(latest.fcfDividendCoverage, NaN);
      if (Number.isFinite(coverage) && coverage < config.fcfCoverageMin) {
        alerts.push({ severity: 'soft', symbol, name, text: `自由现金流仅覆盖股息 ${coverage.toFixed(2)} 倍（${latest.year}）` });
      }
    }

    // 股息削减：最近两个完整年度的常规派息同比（剔除特别股息后比较）。
    const divRows = rows.filter((row) => safeNumber(row.dividendPerShare, 0) > 0);
    if (divRows.length >= 2) {
      const last = divRows[divRows.length - 1];
      const prev = divRows[divRows.length - 2];
      if (last.year - prev.year === 1) {
        const lastDps = regularDps(last);
        const prevDps = regularDps(prev);
        if (prevDps > 0 && lastDps < prevDps * (1 - config.dividendCutThreshold)) {
          alerts.push({ severity: 'hard', symbol, name, text: `${last.year} 年常规股息同比削减 ${formatPct((prevDps - lastDps) / prevDps)}` });
        }
      }
    }

    // 净增发稀释：净回购率显著为负。
    const model = getCompanyReturnModel(symbol);
    if (model && model.buybackYield !== null && model.buybackYield < -config.dilutionMax) {
      alerts.push({ severity: 'soft', symbol, name, text: `净增发约 ${formatPct(Math.abs(model.buybackYield))} 市值（${model.buybackYear} 财年），正在稀释股东` });
    }

    // 估值回归信号（打工仓）：现价股息率跌破历史中位，回归可能已到位。
    if (isIncome) {
      const yieldRank = getDividendYieldPercentile(symbol);
      if (yieldRank && yieldRank.percentile < config.yieldPercentileFloor) {
        alerts.push({ severity: 'soft', symbol, name, text: `股息率 ${formatPct(yieldRank.currentYield)}，低于 ${yieldRank.years} 年中位 ${formatPct(yieldRank.medianYield)}，估值回归或已到位` });
      }
    }
  });

  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'hard' ? -1 : 1));
}
