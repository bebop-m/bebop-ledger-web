"""结算脚本的跨端一致性测试。

这个脚本会直接改写私有仓里的真实持仓数据，但此前没有任何测试覆盖，
「前端写 1 / 本脚本写 1.0」导致同一笔派息被记两遍的问题就是这样漏过去的。

运行：python -m unittest discover -s tests -p "test_*.py"
"""

import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "settle_private_portfolio.py"
_spec = importlib.util.spec_from_file_location("settle_private_portfolio", SCRIPT)
settle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(settle)


def make_portfolio(ledger=None, ignored=None):
    return {
        "type": "portfolio-snapshot",
        "version": 5,
        "holdings": [{"localId": 1, "symbol": "TEST.HK", "quantity": 10, "shares": 10, "bucket": "income"}],
        "rates": {"CNY": 1, "USD": 7, "HKD": 1},
        "dividendLedger": ledger or [],
        "dailySnapshots": [],
        "cashFlows": [],
        "trades": [],
        "positionOpeningDate": "2020-01-01",
        "yearlyManual": [],
        "yearlyArchives": [],
        "yearlyHoldings": [],
        "dividendLedgerIgnored": ignored or [],
    }


def make_market(amount=1):
    return {
        "quotes": {
            "TEST.HK": {
                "name": "Test", "price": 10, "currency": "HKD",
                "dividends": [{
                    "exDate": "2026-06-02", "payDate": "2026-06-20",
                    "amountPerShare": amount, "currency": "HKD", "source": "yahoo",
                }],
            }
        },
        "rates": {"CNY": 1, "USD": 7, "HKD": 1},
    }


def make_entry(source_id):
    return {
        "id": "div_x", "sourceId": source_id, "symbol": "TEST.HK",
        "exDate": "2026-06-02", "payDate": "2026-06-20", "amountPerShare": 1,
        "currency": "HKD", "shares": 10, "sharesSource": "manual", "fxRate": 1,
        "taxRate": 0, "grossCny": 10, "netCny": 10, "bucket": "income",
        "receiptStatus": "received", "confidence": "manual", "confirmed": True,
    }


class CanonicalSourceIdTest(unittest.TestCase):
    def test_integer_amount_matches_frontend_form(self):
        # 前端拼出 "1"，本脚本拼出 "1.0"，归一化后必须一致
        self.assertEqual(
            settle.canonical_source_id("TEST.HK|2026-06-02|1.0|HKD"),
            settle.canonical_source_id("TEST.HK|2026-06-02|1|HKD"),
        )

    def test_decimal_amount_is_preserved(self):
        self.assertEqual(
            settle.canonical_source_id("TEST.HK|2026-06-25|0.4039|HKD"),
            "TEST.HK|2026-06-25|0.4039|HKD",
        )

    def test_malformed_id_passes_through(self):
        self.assertEqual(settle.canonical_source_id("garbage"), "garbage")
        self.assertEqual(settle.canonical_source_id(None), "")


class IgnoreKeyTest(unittest.TestCase):
    def test_amount_is_excluded_so_revisions_do_not_resurrect(self):
        self.assertEqual(
            settle.dividend_ignore_key("TEST.HK|2026-06-02|1|HKD"),
            settle.dividend_ignore_key("TEST.HK|2026-06-02|1.01|HKD"),
        )

    def test_key_stays_scoped_to_one_year(self):
        self.assertNotEqual(
            settle.dividend_ignore_key("TEST.HK|2026-06-02|1|HKD"),
            settle.dividend_ignore_key("TEST.HK|2027-06-02|1|HKD"),
        )


class SettleLedgerTest(unittest.TestCase):
    def assert_single_entry(self, ledger, msg):
        out, _, _ = settle.settle_portfolio(make_portfolio(ledger), make_market(), "2026-07-10")
        self.assertEqual(len(out["dividendLedger"]), 1, msg)

    def test_frontend_style_id_is_not_duplicated(self):
        # 前端写入的整数 ID，结算时不得被认成新事件再追加一条
        self.assert_single_entry([make_entry("TEST.HK|2026-06-02|1|HKD")], "前端格式 ID 被重复追加")

    def test_python_style_id_is_not_duplicated(self):
        self.assert_single_entry([make_entry("TEST.HK|2026-06-02|1.0|HKD")], "脚本格式 ID 被重复追加")

    def test_existing_entry_keeps_its_stored_source_id(self):
        out, _, _ = settle.settle_portfolio(
            make_portfolio([make_entry("TEST.HK|2026-06-02|1|HKD")]), make_market(), "2026-07-10")
        self.assertEqual(out["dividendLedger"][0]["sourceId"], "TEST.HK|2026-06-02|1|HKD")

    def test_ignored_dividend_is_not_recreated(self):
        out, _, _ = settle.settle_portfolio(
            make_portfolio(ignored=["TEST.HK|2026-06-02|1|HKD"]), make_market(), "2026-07-10")
        self.assertEqual(out["dividendLedger"], [], "被删除的派息不得由云端结算重建")

    def test_ignore_survives_amount_revision(self):
        # 数据源把金额从 1 改成 1.01，删除仍应生效
        out, _, _ = settle.settle_portfolio(
            make_portfolio(ignored=["TEST.HK|2026-06-02|1|HKD"]), make_market(1.01), "2026-07-10")
        self.assertEqual(out["dividendLedger"], [], "金额被修订后删除失效")

    def test_ignore_does_not_block_later_years(self):
        market = make_market()
        market["quotes"]["TEST.HK"]["dividends"].append({
            "exDate": "2027-06-02", "payDate": "2027-06-20",
            "amountPerShare": 1, "currency": "HKD", "source": "yahoo",
        })
        out, _, _ = settle.settle_portfolio(
            make_portfolio(ignored=["TEST.HK|2026-06-02|1|HKD"]), market, "2027-07-10")
        ex_dates = [e["exDate"] for e in out["dividendLedger"]]
        self.assertEqual(ex_dates, ["2027-06-02"], "删除某一年不得连带挡住以后年份")


class AuditBoundaryTest(unittest.TestCase):
    def test_rounding_is_symmetric_and_date_is_real(self):
        self.assertEqual(settle.round_money(1.005), 1.01)
        self.assertEqual(settle.round_money(-1.005), -1.01)
        self.assertEqual(settle.round_money(10.075), 10.08)
        self.assertEqual(settle.round_money(-10.075), -10.08)
        self.assertEqual(settle.round_decimal(1.2345675, 6), 1.234568)
        self.assertEqual(settle.round_decimal(-1.2345675, 6), -1.234568)
        self.assertEqual(settle.normalize_date("2026-02-30"), "")
        self.assertEqual(settle.normalize_date("2026-12-31T23:30:00-08:00"), "2026-12-31")

    def test_aggregate_and_components_are_one_economic_event(self):
        entries = [
            {**make_entry("TEST.HK|2026-06-02|3|HKD"), "amountPerShare": 3, "grossCny": 30, "netCny": 30, "confirmed": False, "eventSource": "yahoo"},
            {**make_entry("TEST.HK|2026-06-02|1|HKD"), "grossCny": 10, "netCny": 10, "confirmed": False, "eventSource": "etnet"},
            {**make_entry("TEST.HK|2026-06-02|2|HKD"), "amountPerShare": 2, "grossCny": 20, "netCny": 20, "confirmed": False, "eventSource": "etnet"},
        ]
        normalized = settle.normalize_economic_entries(entries, {"HKD": 1})
        self.assertEqual(len(normalized), 1)
        self.assertEqual(normalized[0]["grossCny"], 30)

        revised = [{**entries[0], "sourceId": "TEST.HK|2026-06-02|3.01|HKD", "grossCny": 30.1}, *entries[1:]]
        self.assertEqual(len(settle.normalize_economic_entries(revised, {"HKD": 1})), 1)

        same_source = [{**entry, "eventSource": "etnet"} for entry in entries]
        self.assertEqual(len(settle.normalize_economic_entries(same_source, {"HKD": 1})), 3)

    def test_snapshot_replays_pre_ex_trade_but_ex_date_trade_is_excluded(self):
        portfolio = make_portfolio()
        portfolio["dailySnapshots"] = [{
            "date": "2026-05-31", "netCny": 90, "totalMarketValueCny": 90,
            "rates": {"CNY": 1, "USD": 7, "HKD": 0.9},
            "holdings": [{"symbol": "TEST.HK", "shares": 100, "bucket": "income", "taxRate": 0.2}],
        }]
        portfolio["trades"] = [
            {"id": "b1", "date": "2026-06-01", "symbol": "TEST.HK", "side": "buy", "shares": 50, "price": 10, "fxRate": 0.9},
            {"id": "b2", "date": "2026-06-02", "symbol": "TEST.HK", "side": "buy", "shares": 25, "price": 10, "fxRate": 0.9},
        ]
        context = settle.dividend_context(portfolio, "TEST.HK", "2026-06-02", "HKD")
        self.assertEqual(context["shares"], 150)
        self.assertEqual(context["fxRate"], 0.9)
        self.assertEqual(context["taxRate"], 0.2)

    def test_missing_history_does_not_backfill_from_current_position(self):
        portfolio = make_portfolio()
        portfolio["positionOpeningDate"] = ""
        context = settle.dividend_context(portfolio, "TEST.HK", "2025-06-02", "HKD")
        self.assertIsNone(context)

    def test_same_day_snapshot_is_replaced_and_contains_cash_scope(self):
        portfolio = make_portfolio()
        portfolio["currentCashCny"] = 100
        portfolio["currentCashAsOfDate"] = "2026-07-10"
        out, _, _ = settle.settle_portfolio(portfolio, make_market(), "2026-07-10")
        out["currentCashCny"] = 250
        out2, _, _ = settle.settle_portfolio(out, make_market(), "2026-07-10")
        rows = [item for item in out2["dailySnapshots"] if item["date"] == "2026-07-10"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["cashCny"], 250)
        self.assertTrue(rows[0]["cashModelActive"])

    def test_manual_pay_date_is_not_overwritten(self):
        entry = make_entry("TEST.HK|2026-06-02|1|HKD")
        entry.update({"confirmed": False, "confidence": "snapshot", "payDate": "2026-07-09", "payDateSource": "manual"})
        market = make_market()
        market["quotes"]["TEST.HK"]["dividends"][0]["payDate"] = "2026-07-12"
        out, _, _ = settle.settle_portfolio(make_portfolio([entry]), market, "2026-07-10")
        self.assertEqual(out["dividendLedger"][0]["payDate"], "2026-07-09")

    def test_cross_year_archive_uses_received_date_and_net_value_chain(self):
        portfolio = make_portfolio([{
            **make_entry("TEST.HK|2025-12-30|1|HKD"),
            "exDate": "2025-12-30", "payDate": "2026-01-02", "receivedDate": "2026-01-02",
            "confirmed": True, "grossCny": 10, "netCny": 10,
        }])
        portfolio["dailySnapshots"] = [
            {"date": "2025-12-31", "netCny": 1000, "rates": {"CNY": 1, "USD": 7, "HKD": 1}, "holdings": []},
            {"date": "2026-12-31", "netCny": 1110, "rates": {"CNY": 1, "USD": 7, "HKD": 1}, "holdings": []},
        ]
        changed = settle.rebuild_completed_year_archives(portfolio, "2027-01-02")
        self.assertTrue(changed)
        row = next(item for item in portfolio["yearlyArchives"] if item["year"] == 2026)
        self.assertEqual(row["dividendCny"], 10)
        self.assertEqual(row["capitalReturnCny"], 110)


if __name__ == "__main__":
    unittest.main()
