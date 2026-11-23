"""가상 DART로 전체 흐름 확인 (네트워크 사용 안 함, 가상 회사만)."""

import datetime as dt
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collector"))

import build  # noqa: E402
from dart import BudgetExceeded  # noqa: E402

TODAY = dt.date(2026, 11, 17)


class FakeDart:
    def __init__(self, n=1200, budget=10**6):
        self.calls = 0
        self.budget = budget
        self.n = n

    def tick(self):
        self.calls += 1
        if self.calls > self.budget:
            raise BudgetExceeded()

    def search(self, a, b, **p):
        self.tick()
        if p.get("pblntf_ty") == "A":
            if p.get("corp_cls") != "K":
                return []
            return [{"corp_code": f"9{i:07d}", "corp_name": f"가상기업{i}", "stock_code": f"{i:06d}", "corp_cls": "K",
                     "report_nm": "분기보고서 (2026.09)" if i == 7 else "사업보고서 (2025.12)", "rcept_dt": "20261114", "rcept_no": f"2026111400{i:04d}"} for i in range(self.n)]
        if p.get("pblntf_ty") == "B":
            return [{"rcept_no": "20260101000001", "corp_code": "90000001", "rcept_dt": "20260101", "report_nm": "주요사항보고서(전환사채권발행결정)"}]
        if p.get("pblntf_ty") == "C":
            return [
                {"corp_code": "80000001", "corp_name": "가상공모", "rcept_dt": "20261101", "report_nm": "증권신고서(지분증권)"},
                {"corp_code": "80000002", "corp_name": "가상캐피탈", "rcept_dt": "20261101", "report_nm": "[기재정정]일괄신고서"},
                {"corp_code": "80000003", "corp_name": "가상증권사", "rcept_dt": "20261102", "report_nm": "투자설명서"},
            ]
        return []

    def rows(self, path, **p):
        self.tick()
        if path == "fnlttMultiAcnt.json":
            codes = [c for c in p["corp_code"].split(",") if (c != "90000007") == (p["reprt_code"] == "11011")]
            return [{"stock_code": f"{int(c[1:]):06d}", "fs_div": "CFS", "account_nm": "매출액", "thstrm_amount": "10000000000"} for c in codes]
        if path == "hyslrSttus.json" and p["corp_code"] == "90000007" and p["reprt_code"] == "11011":
            return []  # 신규상장: 사업보고서 없음
        if path == "hyslrSttus.json":
            return [{"nm": "홍가상", "relate": "본인", "stock_knd": "보통주", "trmend_posesn_stock_qota_rt": "40"}]
        if path == "exctvSttus.json":
            return [{"ofcps": "대표이사", "birth_ym": "1960년 01월"}]
        if path == "cvbdIsDecsn.json":
            return [{"rcept_no": "20260101000001", "bd_fta": "5,000,000,000"}]
        if path == "list.json":
            return [{"rcept_dt": "20261101", "report_nm": "증권신고서(지분증권)", "rcept_no": "20261101000009"}]
        return []

    def document_text(self, rcept_no):
        self.tick()
        return "<td>상장예정일</td><td>2026년 12월 3일</td>"

    def get(self, path, **p):
        self.tick()
        if path == "company.json":
            return {"ceo_nm": "김가상", "corp_cls": "E" if p["corp_code"].startswith("8") and p["corp_code"] != "80000005" else "K", "adres": "서울특별시 가상구", "jurir_no": "1101110000000",
                    "hm_url": "www.gasang.example", "ir_url": "", "phn_no": "02-000-0000"}
        if path == "estkRs.json":
            return {"group": [
                {"title": "일반사항", "list": [{"sbd": "2026년 11월 20일 ~ 2026년 11월 21일", "pymd": "2026년 11월 25일"}]},
                {"title": "증권의종류", "list": [{"slprc": "10,000", "slta": "20,000,000,000"}]},
                {"title": "인수인정보", "list": [{"actsen": "대표주관회사", "actnmn": "가상증권"}]},
            ]}
        return {}


class BuildTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        build.DATA = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_full_run(self):
        b = build.Builder(FakeDart(), None, TODAY)
        # 예전 기준으로 들어온 공모주 아닌 기록은 정리돼야 함
        b.ipo["80000009"] = {"n": "가상카드", "reports": [["20261101", "투자설명서", "x"]], "sbd": ["2026-11-01"], "_upd": "2026-11-17"}
        # 이미 상장해서 비상장 검색에서 빠진 회사 → 기업개황으로 상장 반영
        b.ipo["80000005"] = {"n": "가상상장", "first": "20261001", "reports": [["20261001", "증권신고서(지분증권)", "y"], ["20261110", "증권발행실적보고서", "z"]],
                             "sbd": ["2026-11-05", "2026-11-06"], "pymd": "2026-11-10", "_upd": "2026-11-12"}
        for step in (b.universe, b.financials, b.scan_events, b.scan_ipo, b.details):
            step()
        b.save_all()
        b.outputs()
        listed = build.load("listed.json", [])
        self.assertEqual(len(listed), 1200)
        one = next(r for r in listed if r["c"] == "90000001")
        self.assertEqual(one["rev"], 100)
        self.assertEqual(one["age"], 66)
        self.assertEqual(one["mhr"], 40)
        self.assertEqual(one["mz"], [1, 50, "20260101"])
        self.assertTrue(all(not k.startswith("_") for r in listed for k in r))
        new = next(r for r in listed if r["c"] == "90000007")  # 분기보고서로 보완
        self.assertEqual(new["rev"], 100)
        self.assertEqual(new["fyl"], "2026 3분기 보고서 · 손익 누적")
        self.assertEqual(new["perl"], "2026 3분기 보고서")
        self.assertEqual(new["mhr"], 40)
        self.assertEqual(new["lr"][2], "20261114000007")
        ipo = build.load("ipo.json", [])
        self.assertEqual(sorted(r["n"] for r in ipo), ["가상공모", "가상상장"])  # 일괄신고서 회사는 제외
        ipo = [r for r in ipo if r["n"] == "가상공모"] + [r for r in ipo if r["n"] != "가상공모"]
        self.assertEqual(ipo[0]["stage"], "수요예측")
        self.assertEqual(ipo[0]["lst"], "2026-12-03")
        self.assertEqual(ipo[0]["total"], 200)
        self.assertEqual(ipo[0]["lead"], ["가상증권"])
        self.assertEqual((ipo[0]["hm"], ipo[0]["ir"], ipo[0]["tel"]), ("http://www.gasang.example", None, "02-000-0000"))
        self.assertNotIn("80000009", b.ipo)
        self.assertEqual(next(r for r in ipo if r["c"] == "80000005")["stage"], "상장")
        self.assertEqual(one["tel"], "02-000-0000")

    def test_holder_fix_for_old_records(self):
        b = build.Builder(FakeDart(n=1100), None, TODAY)
        for step in (b.universe, b.financials, b.scan_events, b.scan_ipo, b.details):
            step()
        rec = b.cos["90000005"]
        rec.update(mh="계", mhr=0.0)
        rec.pop("_mhv")
        b.details()
        self.assertEqual((rec["mh"], rec["mhr"]), ("홍가상", 40))
        self.assertFalse(b.needs_holder_fix(rec))

    def test_market_caps(self):
        class FakeCap:
            calls = 0
            def latest(self, today):
                return "20261119", {"000001": 5000}
        b = build.Builder(FakeDart(), None, TODAY)
        b.mc = FakeCap()
        b.universe(); b.market_caps(); b.outputs()
        one = next(r for r in build.load("listed.json", []) if r["c"] == "90000001")
        self.assertEqual(one["cap"], 5000)
        self.assertEqual(build.load("meta.json", {})["cap_date"], "20261119")

    def test_industry_for_finished_companies(self):
        class FakeCI:
            def industry(self, crno):
                return "가상 제조업"
        b = build.Builder(FakeDart(n=1100), None, TODAY)
        for step in (b.universe, b.financials, b.scan_events, b.scan_ipo, b.details):
            step()
        calls = b.d.calls
        b.ci = FakeCI()
        b.details()  # 이미 다 수집된 회사도 업종 이름은 채워야 함
        self.assertEqual(b.cos["90000003"]["ind"], "가상 제조업")
        self.assertEqual(b.d.calls, calls)  # DART 호출은 추가로 하지 않음

    def test_budget_resume(self):
        b = build.Builder(FakeDart(budget=200), None, TODAY)
        with self.assertRaises(BudgetExceeded):
            for step in (b.universe, b.financials, b.scan_events, b.scan_ipo, b.details):
                step()
        b.save_all()
        b2 = build.Builder(FakeDart(), None, TODAY)  # 다음 날 이어서
        b2.details()
        done = sum(1 for v in b2.cos.values() if v.get("_per") == b2.fy)
        self.assertEqual(done, 1200)


if __name__ == "__main__":
    unittest.main()
