"""값 추출 확인 (가상 회사·가상 인물만)."""

import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collector"))

import parse as P  # noqa: E402
from dart import windows  # noqa: E402


class CapTest(unittest.TestCase):
    def test_parse_caps(self):
        from marketcap import parse_caps
        items = [{"srtnCd": "000001", "mrktTotAmt": 123456000000}, {"srtnCd": "A0001A0", "mrktTotAmt": "990000000"}, {"srtnCd": "000003"}]
        self.assertEqual(parse_caps(items), {"000001": 1235, "0001A0": 10})


class ParseTest(unittest.TestCase):
    def test_multi_financials_prefers_consolidated(self):
        rows = [
            {"stock_code": "000001", "fs_div": "OFS", "account_nm": "매출액", "thstrm_amount": "10,000,000,000"},
            {"stock_code": "000001", "fs_div": "CFS", "account_nm": "매출액", "thstrm_amount": "20,000,000,000"},
            {"stock_code": "000001", "fs_div": "CFS", "account_nm": "영업이익", "thstrm_amount": "-1,000,000,000"},
            {"stock_code": "000001", "fs_div": "CFS", "account_nm": "부채총계", "thstrm_amount": "5,000,000,000"},
            {"stock_code": "000001", "fs_div": "CFS", "account_nm": "자본총계", "thstrm_amount": "10,000,000,000"},
            {"stock_code": "000002", "fs_div": "OFS", "account_nm": "매출액", "thstrm_amount": "300,000,000"},
        ]
        f = P.multi_financials(rows)
        self.assertEqual(f["000001"]["rev"], 200)
        self.assertEqual(f["000001"]["op"], -10)
        self.assertEqual(f["000001"]["opm"], -5.0)
        self.assertEqual(f["000001"]["dr"], 50)
        self.assertEqual(f["000002"]["rev"], 3)

    def test_quarter_cumulative(self):
        rows = [{"stock_code": "000009", "fs_div": "CFS", "sj_div": "IS", "account_nm": "매출액", "thstrm_amount": "1,000,000,000", "thstrm_add_amount": "3,000,000,000"},
                {"stock_code": "000009", "fs_div": "CFS", "sj_div": "BS", "account_nm": "자산총계", "thstrm_amount": "9,000,000,000", "thstrm_add_amount": ""}]
        f = P.multi_financials(rows, cumulative=True)["000009"]
        self.assertEqual((f["rev"], f["ta"]), (30, 90))
        self.assertEqual(P.multi_financials(rows)["000009"]["rev"], 10)

    def test_report_period(self):
        self.assertEqual(P.report_period("분기보고서 (2026.09)"), (2026, "11014"))
        self.assertEqual(P.report_period("[기재정정]반기보고서 (2026.06)"), (2026, "11012"))
        self.assertEqual(P.report_period("사업보고서 (2025.12)"), (2025, "11011"))
        self.assertIsNone(P.report_period("주요사항보고서(유상증자결정)"))
        self.assertEqual(P.period_label(2026, "11014"), "2026 3분기 보고서")

    def test_cash(self):
        rows = [{"sj_div": "BS", "account_id": "ifrs-full_CashAndCashEquivalents", "account_nm": "현금및현금성자산", "thstrm_amount": "12,300,000,000"}]
        self.assertEqual(P.cash_from_statements(rows), 123)
        self.assertIsNone(P.cash_from_statements([{"sj_div": "CF", "account_nm": "현금및현금성자산", "thstrm_amount": "1"}]))

    def test_major_holder(self):
        rows = [
            {"nm": "홍가상", "relate": "본인", "stock_knd": "보통주", "trmend_posesn_stock_qota_rt": "30.10"},
            {"nm": "홍가족", "relate": "친인척", "stock_knd": "보통주", "trmend_posesn_stock_qota_rt": "5.00"},
            {"nm": "계", "relate": "-", "stock_knd": "보통주", "trmend_posesn_stock_qota_rt": "35.10"},
        ]
        self.assertEqual(P.major_holder(rows), {"mh": "홍가상", "mhr": 35.1})

    def test_major_holder_zero_total_and_no_self(self):
        rows = [
            {"nm": "가상모회사", "relate": "최대주주", "stock_knd": "보통주", "trmend_posesn_stock_qota_rt": "21.00"},
            {"nm": "가상재단", "relate": "계열회사", "stock_knd": "보통주", "trmend_posesn_stock_qota_rt": "4.00"},
            {"nm": "계", "relate": "", "stock_knd": "보통주", "trmend_posesn_stock_qota_rt": "0.00"},
        ]
        self.assertEqual(P.major_holder(rows), {"mh": "가상모회사", "mhr": 25.0})
        rows2 = [{"nm": "계", "relate": "", "trmend_posesn_stock_qota_rt": "30"}, {"nm": "가상법인", "relate": "특수관계인", "trmend_posesn_stock_qota_rt": "30"}]
        self.assertEqual(P.major_holder(rows2)["mh"], "가상법인")

    def test_ceo_age(self):
        rows = [
            {"ofcps": "대표이사", "birth_ym": "1960년 12월"},
            {"ofcps": "사외이사", "birth_ym": "1950년 01월"},
            {"ofcps": "사장", "chrg_job": "대표이사", "birth_ym": "1970년 01월"},
        ]
        self.assertEqual(P.ceo_age(rows, dt.date(2026, 11, 17)), 65)

    def test_shares(self):
        rows = [{"se": "보통주", "istc_totqy": "900", "tesstk_co": "9"}, {"se": "합계", "istc_totqy": "1,000", "tesstk_co": "50"}]
        self.assertEqual(P.shares(rows), {"sh": 1000, "tsr": 5.0})

    def test_employees(self):
        rows = [
            {"fo_bbm": "가상부문", "sexdstn": "남", "sm": "70", "jan_salary_am": "60,000,000", "avrg_cnwk_sdytrn": "5"},
            {"fo_bbm": "가상부문", "sexdstn": "여", "sm": "30", "jan_salary_am": "50,000,000", "avrg_cnwk_sdytrn": "4"},
        ]
        self.assertEqual(P.employees(rows), {"emp": 100, "sal": 55, "ten": 4.5})

    def test_bond(self):
        rows = [
            {"remndr_exprtn1": "공모", "remndr_exprtn2": "", "sm": "10,000,000,000"},
            {"remndr_exprtn1": "합계", "remndr_exprtn2": "", "sm": "30,000,000,000"},
        ]
        self.assertEqual(P.bond_balance(rows), 300)

    def test_event_type(self):
        self.assertEqual(P.event_type("주요사항보고서(전환사채권발행결정)"), "CB")
        self.assertEqual(P.event_type("[기재정정]주요사항보고서(유상증자결정)"), "RI")
        self.assertEqual(P.event_type("주요사항보고서(자기주식취득결정)"), "TQ")
        self.assertIsNone(P.event_type("주요사항보고서(자기주식처분결정)"))

    def test_dates_and_stage(self):
        sbd = P.dates_in("2026년 11월 20일 ~ 2026년 11월 21일")
        self.assertEqual(sbd, ["2026-11-20", "2026-11-21"])
        self.assertEqual(P.dates_in("2026.12.01"), ["2026-12-01"])
        t = dt.date(2026, 11, 17)
        self.assertEqual(P.ipo_stage(t, ["증권신고서(지분증권)"], False, sbd), "수요예측")
        self.assertEqual(P.ipo_stage(t, ["[발행조건확정]증권신고서(지분증권)"], False, sbd), "청약예정")
        self.assertEqual(P.ipo_stage(dt.date(2026, 11, 21), [], False, sbd), "청약중")
        self.assertEqual(P.ipo_stage(t, ["철회신고서"], False, sbd), "철회")
        self.assertEqual(P.ipo_stage(t, [], True, sbd), "상장")
        self.assertEqual(P.ipo_stage(t, ["증권신고서(지분증권)"], False, []), "증권신고서")
        self.assertEqual(P.ipo_stage(dt.date(2026, 12, 3), ["증권발행실적보고서"], False, sbd, "2026-12-03"), "상장")
        self.assertEqual(P.ipo_stage(dt.date(2026, 12, 2), ["증권발행실적보고서"], False, sbd, "2026-12-03"), "납입·상장대기")

    def test_equity_registration(self):
        self.assertTrue(P.is_equity_registration("증권신고서(지분증권)"))
        self.assertTrue(P.is_equity_registration("[발행조건확정]증권신고서(지분증권)"))
        self.assertFalse(P.is_equity_registration("[기재정정]일괄신고서"))
        self.assertFalse(P.is_equity_registration("증권신고서(채무증권)"))
        self.assertFalse(P.is_equity_registration("증권신고서(투자계약증권)"))
        self.assertFalse(P.is_equity_registration("투자설명서"))
        self.assertFalse(P.is_equity_registration("증권신고서(합병)"))

    def test_contacts(self):
        c = P.contacts({"hm_url": "www.gasang.example", "ir_url": "https://ir.gasang.example", "phn_no": "02-000-0000"})
        self.assertEqual(c, {"hm": "http://www.gasang.example", "ir": "https://ir.gasang.example", "tel": "02-000-0000"})
        self.assertEqual(P.contacts({"hm_url": "-", "phn_no": ""}), {"hm": None, "ir": None, "tel": None})

    def test_listing_date(self):
        doc = "<P>청약기일 2026년 11월 20일</P><TD>상장 예정일</TD><TD>2026년 12월 3일</TD>"
        self.assertEqual(P.listing_date(doc), "2026-12-03")
        self.assertEqual(P.listing_date("<p>매매개시 예정일 : 2026.12.10</p>"), "2026-12-10")
        self.assertIsNone(P.listing_date("<p>상장예정일은 추후 확정됩니다</p>"))
        # 원문 속 과거 날짜(다른 회사 사례 등)는 상장일로 보지 않음
        old_case = "<td>상장일</td><td>2024년 3월 26일</td><p>매매개시 예정일 2026.12.17</p>"
        self.assertEqual(P.listing_date(old_case, "2026-12-10"), "2026-12-17")
        self.assertIsNone(P.listing_date("<td>상장일</td><td>2024년 3월 26일</td>", "2026-12-10"))
        # 일정표: 날짜가 앞, 절차가 뒤
        table = "<tr><td>2026년 12월 10일</td><td>납입 및 환불</td></tr><tr><td>2026년 12월 17일</td><td>상장 예정</td></tr>"
        self.assertEqual(P.listing_date(table, "2026-12-10"), "2026-12-17")
        self.assertIsNone(P.listing_date("<td>상장예정일</td><td>2027년 3월 23일</td>", "2026-12-03"))  # 너무 먼 날짜
        self.assertIsNone(P.listing_date("<p>상장 2027년 1월 1일</p>", "2026-12-21"))  # 휴장일(1/1)
        self.assertIsNone(P.listing_date("<p>상장예정일 2026년 12월 19일</p>", "2026-12-10"))  # 토요일
        self.assertEqual(P.listing_floor(["2026-12-07", "2026-12-08"], "2026-12-10", "20261021"), "2026-12-10")
        self.assertEqual(P.listing_floor([], None, "20261021"), "2026-10-21")

    def test_region(self):
        self.assertEqual(P.region("서울특별시 가상구 가상로 1"), "서울")
        self.assertEqual(P.region("충청남도 가상시"), "충남")
        self.assertEqual(P.region("경기도 가상시"), "경기")
        self.assertIsNone(P.region(""))

    def test_document_main_first(self):
        import io, zipfile
        from dart import Dart
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("20260101000001_00760.xml", "감사보고서 " * 5000)
            z.writestr("20260101000001.xml", "본문 상장예정일 2026년 12월 3일")
        d = Dart("x", 10)
        d._raw = lambda path, params: buf.getvalue()
        self.assertTrue(d.document_text("20260101000001").startswith("본문"))

    def test_windows(self):
        w = windows(dt.date(2026, 1, 1), dt.date(2026, 6, 30))
        self.assertEqual(w[0][0], dt.date(2026, 1, 1))
        self.assertEqual(w[-1][1], dt.date(2026, 6, 30))
        self.assertTrue(all((b - a).days <= 89 for a, b in w))


if __name__ == "__main__":
    unittest.main()
