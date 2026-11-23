"""DART 응답 → 화면용 값 (가상 데이터로 테스트: tests/)."""

from __future__ import annotations

import datetime as dt
import re

EOK = 100_000_000


def num(s) -> float | None:
    if s is None:
        return None
    s = str(s).replace(",", "").strip()
    if s in ("", "-"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def eok(won, digits: int = 0):
    v = num(won)
    if v is None:
        return None
    r = round(v / EOK, digits)
    return int(r) if digits == 0 else r


def norm(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


# ── 재무: 다중회사 주요계정 (fnlttMultiAcnt) ──
MULTI_ACCOUNTS = {
    "매출액": "rev",
    "영업이익": "op",
    "당기순이익": "ni",
    "자산총계": "ta",
    "부채총계": "tl",
    "자본총계": "te",
}


def multi_financials(rows: list[dict], cumulative: bool = False) -> dict[str, dict]:
    """종목코드별 {rev, op, ni, ta, tl, te(억원), opm(%), dr(%), fs} — 연결(CFS) 우선, 없으면 개별"""
    raw: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = MULTI_ACCOUNTS.get(norm(r.get("account_nm", "")))
        code = (r.get("stock_code") or "").strip()
        if not key or not code:
            continue
        amt = r.get("thstrm_amount")
        if cumulative and r.get("sj_div") in ("IS", "CIS") and (r.get("thstrm_add_amount") or "").strip() not in ("", "-"):
            amt = r.get("thstrm_add_amount")  # 분기·반기 손익은 누적 금액
        raw.setdefault((code, r.get("fs_div") or ""), {})[key] = eok(amt)
    out: dict[str, dict] = {}
    for (code, fs), vals in raw.items():
        if code in out and out[code]["fs"] == "CFS":
            continue
        if fs == "CFS" or code not in out:
            out[code] = {"fs": fs, **vals}
    for v in out.values():
        v["opm"] = round(v["op"] / v["rev"] * 100, 1) if v.get("rev") and v.get("op") is not None else None
        v["dr"] = round(v["tl"] / v["te"] * 100) if v.get("te") and v["te"] > 0 and v.get("tl") is not None else None
    return out


# ── 현금: 전체 재무제표 (fnlttSinglAcntAll) ──
def cash_from_statements(rows: list[dict]) -> int | None:
    for r in rows:
        if r.get("sj_div") == "BS" and r.get("account_id") == "ifrs-full_CashAndCashEquivalents":
            v = eok(r.get("thstrm_amount"))
            if v is not None:
                return v
    for r in rows:
        if r.get("sj_div") == "BS" and norm(r.get("account_nm", "")) == "현금및현금성자산":
            v = eok(r.get("thstrm_amount"))
            if v is not None:
                return v
    return None


# ── 최대주주 (hyslrSttus) ──
def major_holder(rows: list[dict]) -> dict:
    """최대주주 이름과 최대주주+특수관계인 합계 지분율(보통주)"""
    common = [r for r in rows if "보통" in (r.get("stock_knd") or "") or not r.get("stock_knd")]
    rows = common or rows
    is_total = lambda r: norm(r.get("nm", "")) in ("계", "합계", "소계") or norm(r.get("relate", "")) in ("계", "합계")
    people = [r for r in rows if not is_total(r)]
    total = None
    for r in rows:
        if is_total(r):
            total = num(r.get("trmend_posesn_stock_qota_rt"))
    if not total:  # 합계 줄이 없거나 0으로 적힌 경우 → 개별 합산
        vals = [num(r.get("trmend_posesn_stock_qota_rt")) for r in people]
        vals = [v for v in vals if v is not None]
        total = round(sum(vals), 2) if vals and sum(vals) > 0 else None
    name = next((r.get("nm") for r in people if "본인" in (r.get("relate") or "") or "최대주주" in (r.get("relate") or "")), None)
    if not name and people:
        name = max(people, key=lambda r: num(r.get("trmend_posesn_stock_qota_rt")) or 0).get("nm")
    return {"mh": (name or "").strip() or None, "mhr": total}


# ── 대표 나이 (exctvSttus) ──
def ceo_age(rows: list[dict], today: dt.date) -> int | None:
    ages = []
    for r in rows:
        title = (r.get("ofcps") or "") + " " + (r.get("chrg_job") or "")
        if "대표" not in title:
            continue
        m = re.search(r"(\d{4})\D+(\d{1,2})", r.get("birth_ym") or "")
        if not m:
            continue
        y, mo = int(m.group(1)), int(m.group(2))
        ages.append(today.year - y - (1 if today.month < mo else 0))
    return max(ages) if ages else None


# ── 주식 총수 (stockTotqySttus) ──
def shares(rows: list[dict]) -> dict:
    pick = None
    for r in rows:
        if norm(r.get("se", "")) == "합계":
            pick = r
    if pick is None:
        pick = next((r for r in rows if "보통" in (r.get("se") or "")), None)
    if not pick:
        return {}
    total = num(pick.get("istc_totqy"))
    tre = num(pick.get("tesstk_co"))
    return {
        "sh": int(total) if total else None,
        "tsr": round(tre / total * 100, 2) if total and tre is not None else None,
    }


# ── 직원 (empSttus) ──
def employees(rows: list[dict]) -> dict:
    tot = [r for r in rows if norm(r.get("fo_bbm", "")) in ("합계", "전체", "계") or norm(r.get("sexdstn", "")) in ("합계", "계")]
    use = tot or rows
    cnt = sum(num(r.get("sm")) or 0 for r in use)
    sal = [num(r.get("jan_salary_am")) for r in use if num(r.get("jan_salary_am"))]
    ten = [num(r.get("avrg_cnwk_sdytrn")) for r in use if num(r.get("avrg_cnwk_sdytrn"))]
    return {
        "emp": int(cnt) if cnt else None,
        # 1인 평균 급여: 원 → 백만원
        "sal": round(sum(sal) / len(sal) / 1_000_000) if sal else None,
        "ten": round(sum(ten) / len(ten), 1) if ten else None,
    }


# ── 회사채 미상환 잔액 (cprndNrdmpBlce) ──
def bond_balance(rows: list[dict]) -> int | None:
    for r in rows:
        if norm(r.get("remndr_exprtn1", "")) == "합계" or norm(r.get("remndr_exprtn2", "")) == "합계":
            v = num(r.get("sm"))
            if v is not None:
                return round(v / EOK)
    vals = [num(r.get("sm")) for r in rows if num(r.get("sm")) is not None]
    return round(sum(vals) / EOK) if vals else None


# ── 배당 (alotMatter) ──
def payout(rows: list[dict]) -> float | None:
    for r in rows:
        if "현금배당성향" in norm(r.get("se", "")):
            return num(r.get("thstrm"))
    return None


# ── 감사인 (accnutAdtorNmNdAdtOpinion) ──
def auditor(rows: list[dict]) -> dict:
    for r in rows:
        if "당기" in (r.get("bsns_year") or "") or r.get("adtor"):
            return {"aud": (r.get("adtor") or "").strip() or None, "audop": (r.get("adt_opinion") or "").strip() or None}
    return {}


# ── 주요사항보고서 분류 (list.json report_nm) ──
EVENT_TYPES = [
    ("전환사채권발행결정", "CB"),
    ("신주인수권부사채권발행결정", "BW"),
    ("교환사채권발행결정", "EB"),
    ("유무상증자결정", "RI"),
    ("유상증자결정", "RI"),
    ("자기주식취득결정", "TQ"),
]


def event_type(report_nm: str) -> str | None:
    n = norm(report_nm)
    if "철회" in n:
        return None
    for key, t in EVENT_TYPES:
        if key in n:
            return t
    return None


# ── 공모 일정 문자열 → 날짜들 ──
def dates_in(s: str) -> list[str]:
    out = []
    for y, m, d in re.findall(r"(20\d{2})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})", s or ""):
        try:
            out.append(dt.date(int(y), int(m), int(d)).isoformat())
        except ValueError:
            pass
    return out


def ipo_stage(today: dt.date, reports: list[str], listed: bool, sbd: list[str], lst: str | None = None) -> str:
    names = [norm(r) for r in reports]
    if any("철회" in n for n in names):
        return "철회"
    if listed or (lst and today.isoformat() >= lst):
        return "상장"
    if any("증권발행실적보고서" in n for n in names):
        return "납입·상장대기"
    t = today.isoformat()
    if sbd:
        if t < sbd[0]:
            return "청약예정" if any("발행조건확정" in n for n in names) else "수요예측"
        if t <= sbd[-1]:
            return "청약중"
        return "납입·상장대기"
    return "증권신고서"


REGIONS = {"서울": "서울", "부산": "부산", "대구": "대구", "인천": "인천", "광주": "광주", "대전": "대전", "울산": "울산",
           "세종": "세종", "경기": "경기", "강원": "강원", "충청북": "충북", "충북": "충북", "충청남": "충남", "충남": "충남",
           "전라북": "전북", "전북": "전북", "전라남": "전남", "전남": "전남", "경상북": "경북", "경북": "경북",
           "경상남": "경남", "경남": "경남", "제주": "제주"}


def region(addr: str) -> str | None:
    """주소 → 시·도 약칭 (예: 서울특별시 → 서울)"""
    first = (addr or "").strip().split(" ")[0]
    for k, v in REGIONS.items():
        if first.startswith(k):
            return v
    return first[:4] or None


def is_equity_registration(report_nm: str) -> bool:
    """공모주 판단: 증권신고서(지분증권)만 (투자설명서·일괄신고서·채무증권·투자계약증권·합병·분할 등 제외)"""
    return "증권신고서(지분증권)" in norm(report_nm)


REPORT_CODES = {3: "11013", 6: "11012", 9: "11014", 12: "11011"}
REPORT_LABEL = {"11013": "1분기", "11012": "반기", "11014": "3분기", "11011": "사업보고서"}


def report_period(report_nm: str) -> tuple[int, str] | None:
    """'분기보고서 (2026.09)' → (2026, '11014')  — 정기보고서의 사업연도와 보고서 코드"""
    n = norm(report_nm)
    if not any(k in n for k in ("사업보고서", "반기보고서", "분기보고서")):
        return None
    m = re.search(r"\((\d{4})\.(\d{2})\)", n)
    if not m:
        return None
    y, mo = int(m.group(1)), int(m.group(2))
    code = REPORT_CODES.get(mo)
    if not code:  # 12월 결산이 아닌 회사: 보고서 종류로 판단
        code = "11011" if "사업보고서" in n else "11012" if "반기" in n else "11014"
    return y, code


def period_label(year: int, code: str) -> str:
    lab = REPORT_LABEL.get(code, "")
    return f"{year} 사업보고서" if code == "11011" else f"{year} {lab} 보고서"


LISTING_KEYS = ("상장예정일", "매매개시예정일", "상장(예정)일", "매매개시일", "신규상장예정일", "상장일", "상장예정", "매매개시")


def html_text(doc: str) -> str:
    import html as _html
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", doc or "")
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", _html.unescape(t))


def listing_ok(d: str | None, after: str | None, days: int = 30) -> bool:
    """상장일 후보가 그럴듯한지: after(청약·납입 기준일)보다 뒤이고 30일 안, 거래일(평일, 1/1·12/31 휴장일 제외)"""
    if not d:
        return False
    day = dt.date.fromisoformat(d)
    if day.weekday() >= 5 or d[5:] in ("01-01", "12-31"):
        return False
    if not after:
        return True
    return after < d <= (dt.date.fromisoformat(after) + dt.timedelta(days=days)).isoformat()


def listing_date(doc: str, after: str | None = None) -> str | None:
    """증권신고서·투자설명서 원문에서 상장(매매개시) 예정일. 날짜가 정해져 있지 않으면 None
    after: 이 날짜(YYYY-MM-DD) 뒤 30일 안의 거래일만 인정 (원문 속 과거 사례·보호예수 날짜 등을 잘못 읽지 않게)"""
    text = html_text(doc)
    flat = text.replace(" ", "")
    # 1) "상장예정일 : 2026년 12월 3일" 처럼 날짜가 뒤에 오는 경우
    for key in LISTING_KEYS:
        for m in re.finditer(re.escape(key), flat):
            ds = [d for d in dates_in(flat[m.end(): m.end() + 40])[:1] if listing_ok(d, after)]
            if ds:
                return ds[0]
    # 2) 일정표 "2026년 12월 3일 | 상장 예정" 처럼 날짜가 앞에 오는 경우 (바로 앞 날짜)
    if after:
        for key in ("상장", "매매개시"):
            for m in re.finditer(re.escape(key), flat):
                ds = dates_in(flat[max(0, m.start() - 30): m.start()])
                if ds and listing_ok(ds[-1], after):
                    return ds[-1]
    return None


def listing_floor(sbd: list[str] | None, pymd: str | None, first: str | None) -> str | None:
    """상장일은 이 날짜보다 뒤여야 함: 청약 마지막 날·납입일, (둘 다 없으면) 신고서 제출일"""
    cands = []
    if sbd:
        cands.append(sbd[-1])
    if pymd:
        cands.append(pymd)
    if not cands and first and len(first) == 8:
        cands.append(f"{first[:4]}-{first[4:6]}-{first[6:]}")
    return max(cands) if cands else None


def _url(u: str | None) -> str | None:
    u = (u or "").strip()
    if not u or u in ("-", "없음"):
        return None
    return u if u.startswith(("http://", "https://")) else "http://" + u


def contacts(info: dict) -> dict:
    """DART 기업개황 → 홈페이지·IR 페이지·대표번호"""
    tel = (info.get("phn_no") or "").strip()
    return {"hm": _url(info.get("hm_url")), "ir": _url(info.get("ir_url")), "tel": tel if tel and tel != "-" else None}
