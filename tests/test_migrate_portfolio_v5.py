import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

from migrate_portfolio_v5 import migrate_snapshot  # noqa: E402


class PortfolioV5MigrationTest(unittest.TestCase):
    def test_migration_collapses_duplicates_and_deletes_unverified_history(self):
        payload = {
            "version": 4,
            "holdings": [
                {"symbol": "TEST.HK", "quantity": 10, "taxRateOverride": "120"},
                {"symbol": "TEST.HK", "quantity": 5},
            ],
            "positionOpeningDate": "",
            "dailySnapshots": [],
            "cashFlows": [],
            "trades": [],
            "yearlyArchives": [],
            "yearlyManual": [],
            "yearlyHoldings": [{"year": 2025, "source": "backfill", "holdings": []}],
            "dividendLedgerIgnored": [],
            "dividendLedger": [{
                "id": "d1", "sourceId": "TEST.HK|2025-06-02|1|HKD", "symbol": "TEST.HK",
                "exDate": "2025-06-02", "amountPerShare": 1, "currency": "HKD",
                "shares": 15, "sharesSource": "current", "fxRate": 1, "taxRate": 2,
                "grossCny": 15, "netCny": 15, "confirmed": False,
            }],
        }
        migrated, report = migrate_snapshot(payload, "2026-07-23")
        self.assertEqual(migrated["version"], 5)
        self.assertEqual(len(migrated["holdings"]), 1)
        self.assertEqual(migrated["holdings"][0]["quantity"], 15)
        self.assertEqual(migrated["holdings"][0]["taxRateOverride"], "100")
        # 记账起点之前、无持仓锚点的倒推条目直接删除：这个账本从 2026 年才开始记录。
        self.assertEqual(migrated["dividendLedger"], [])
        self.assertEqual(migrated["yearlyHoldings"], [])
        self.assertEqual(report["holdingsCollapsed"], 1)
        self.assertEqual(report["unverifiedHistoricalRemoved"], 1)
        self.assertEqual(report["unsafeYearlyBackfillsRemoved"], 1)

    def test_confirmed_entries_survive_even_without_anchor(self):
        payload = {
            "version": 4,
            "holdings": [{"symbol": "TEST.HK", "quantity": 10}],
            "positionOpeningDate": "",
            "dailySnapshots": [], "cashFlows": [], "trades": [],
            "yearlyArchives": [], "yearlyManual": [], "yearlyHoldings": [],
            "dividendLedgerIgnored": [],
            "dividendLedger": [{
                "id": "d1", "sourceId": "TEST.HK|2026-01-23|1|HKD", "symbol": "TEST.HK",
                "exDate": "2026-01-23", "amountPerShare": 1, "currency": "HKD",
                "shares": 10, "sharesSource": "current", "fxRate": 1, "taxRate": 0,
                "grossCny": 10, "netCny": 10, "confirmed": True,
            }],
        }
        migrated, report = migrate_snapshot(payload, "2026-07-23")
        self.assertEqual(len(migrated["dividendLedger"]), 1, "用户确认过的实收必须原样保留")
        self.assertEqual(report["unverifiedHistoricalRemoved"], 0)


if __name__ == "__main__":
    unittest.main()
