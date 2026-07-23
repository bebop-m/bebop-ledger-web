"""行情脚本派息事件合并的重复防护测试。

真实事故：同一笔派息被三个数据源写成三条事件——
yahoo 报合计（或港币折算值）、etnet 拆成末期息+特别息（或用申报币种 USD）。
下游结算逐条建账，同一笔钱被记 2–3 遍。这里固化「等值跨源折叠」与
「聚合=分量之和折叠」两条规则，同时保证合法的同源多笔派息不被误删。

运行：python -m unittest discover -s tests -p "test_*.py"
"""

import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "update_market_data.py"
_spec = importlib.util.spec_from_file_location("update_market_data", SCRIPT)
market = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(market)

RATES = {"CNY": 1, "USD": 6.7659, "HKD": 0.863}


def ev(ex_date, amount, currency="HKD", source="yahoo", pay_date="", announce_date=""):
    event = {
        "exDate": ex_date,
        "amountPerShare": amount,
        "currency": currency,
        "source": source,
        "payDate": pay_date,
    }
    if announce_date:
        event["announceDate"] = announce_date
    return event


class SameDividendEventTest(unittest.TestCase):
    def test_cross_currency_same_event_matches_with_rates(self):
        # 京东：etnet 报 0.5 USD，yahoo 报 3.92073 HKD，是同一笔派息
        self.assertTrue(market.same_dividend_event(
            ev("2026-04-08", 3.92073, "HKD"), ev("2026-04-08", 0.5, "USD"), RATES))

    def test_cross_currency_without_rates_stays_conservative(self):
        self.assertFalse(market.same_dividend_event(
            ev("2026-04-08", 3.92073, "HKD"), ev("2026-04-08", 0.5, "USD")))

    def test_cross_currency_different_amounts_do_not_match(self):
        self.assertFalse(market.same_dividend_event(
            ev("2026-04-08", 3.92073, "HKD"), ev("2026-04-08", 0.25, "USD"), RATES))

    def test_same_currency_tolerance_unchanged(self):
        self.assertTrue(market.same_dividend_event(
            ev("2026-05-15", 4.5), ev("2026-05-16", 4.5), RATES))
        self.assertFalse(market.same_dividend_event(
            ev("2026-05-15", 4.5), ev("2026-05-15", 4.0), RATES))


class CollapseDuplicateEventsTest(unittest.TestCase):
    def collapse(self, events, quote_currency="HKD"):
        return market.collapse_duplicate_dividend_events(events, quote_currency, RATES)

    def test_cross_currency_equal_pair_folds_to_quote_currency(self):
        out = self.collapse([
            ev("2026-04-08", 3.92073, "HKD", "yahoo"),
            ev("2026-04-08", 0.5, "USD", "etnet", pay_date="2026-05-08"),
        ])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["currency"], "HKD", "应保留报价币种表示，sourceId 才稳定")
        self.assertEqual(out[0]["payDate"], "2026-05-08", "被折叠一侧的 payDate 必须补进保留侧")

    def test_aggregate_plus_components_folds_to_aggregate(self):
        # 01836：yahoo 合计 0.93 = etnet 末期 0.56 + 特别 0.37
        out = self.collapse([
            ev("2026-05-19", 0.93, "HKD", "yahoo"),
            ev("2026-05-19", 0.56, "HKD", "etnet", pay_date="2026-06-12"),
            ev("2026-05-19", 0.37, "HKD", "etnet", pay_date="2026-06-12"),
        ])
        self.assertEqual(len(out), 1)
        self.assertAlmostEqual(out[0]["amountPerShare"], 0.93)
        self.assertEqual(out[0]["payDate"], "2026-06-12")

    def test_same_source_split_without_aggregate_is_preserved(self):
        # 合法场景：同源末期息+特别息，无合计项 → 两笔都保留
        out = self.collapse([
            ev("2026-05-19", 0.56, "HKD", "etnet"),
            ev("2026-05-19", 0.37, "HKD", "etnet"),
        ])
        self.assertEqual(len(out), 2)

    def test_same_source_aggregate_is_not_folded(self):
        # 聚合折叠只在跨数据源时触发，避免误伤同源真实多笔
        out = self.collapse([
            ev("2026-05-19", 0.93, "HKD", "etnet"),
            ev("2026-05-19", 0.56, "HKD", "etnet"),
            ev("2026-05-19", 0.37, "HKD", "etnet"),
        ])
        self.assertEqual(len(out), 3)

    def test_unrelated_amounts_are_kept(self):
        out = self.collapse([
            ev("2026-05-19", 1.0, "HKD", "yahoo"),
            ev("2026-05-19", 0.3, "HKD", "etnet"),
        ])
        self.assertEqual(len(out), 2)

    def test_cross_source_same_currency_reporting_gap_folds(self):
        # 领展 REIT：etnet 1.5959 vs yahoo 1.550903（差 2.9%），是同一笔分派的申报差异
        out = self.collapse([
            ev("2021-11-22", 1.5959, "HKD", "etnet", pay_date="2021-12-13"),
            ev("2021-11-22", 1.550903, "HKD", "yahoo"),
        ])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["payDate"], "2021-12-13")

    def test_same_source_reporting_gap_is_not_folded(self):
        # 同源两条金额相近 → 数据源刻意列出的两笔，保留
        out = self.collapse([
            ev("2021-11-22", 1.5959, "HKD", "etnet"),
            ev("2021-11-22", 1.55, "HKD", "etnet"),
        ])
        self.assertEqual(len(out), 2)

    def test_different_ex_dates_never_grouped(self):
        out = self.collapse([
            ev("2026-05-19", 0.93, "HKD", "yahoo"),
            ev("2026-08-20", 0.93, "HKD", "etnet"),
        ])
        self.assertEqual(len(out), 2)


class MergeEventListsCrossCurrencyTest(unittest.TestCase):
    def test_announced_cross_currency_fills_metadata_without_representation_churn(self):
        merged = market.merge_dividend_event_lists(
            [ev("2026-04-08", 3.92073, "HKD", "yahoo")],
            [ev("2026-04-08", 0.5, "USD", "etnet", pay_date="2026-05-08", announce_date="2026-03-06")],
            "09618.HK", "HKD", RATES)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["currency"], "HKD")
        self.assertAlmostEqual(merged[0]["amountPerShare"], 3.92073)
        self.assertEqual(merged[0]["payDate"], "2026-05-08")
        self.assertEqual(merged[0]["announceDate"], "2026-03-06")


if __name__ == "__main__":
    unittest.main()
