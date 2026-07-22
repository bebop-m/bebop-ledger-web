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
        "version": 4,
        "holdings": [{"localId": 1, "symbol": "TEST.HK", "quantity": 10, "shares": 10, "bucket": "income"}],
        "rates": {"CNY": 1, "USD": 7, "HKD": 1},
        "dividendLedger": ledger or [],
        "dailySnapshots": [],
        "cashFlows": [],
        "trades": [],
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


if __name__ == "__main__":
    unittest.main()
