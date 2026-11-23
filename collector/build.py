"""매일 실행: DART 등에서 공개 정보를 모아 data/*.json 을 만든다.

단계 (호출이 적고 중요한 것부터, 하루 예산 안에서 진행 → 다 못 하면 다음 날 이어서)
 1. 상장사 목록: 최근 6개월 정기공시(list.json pblntf_ty=A) 제출 회사 중 유가·코스닥·코넥스  (주 1회)
 2. 재무: 다중회사 주요계정(fnlttMultiAcnt, 100개씩)                                     (주 1회)
 3. 주요사항보고서 이벤트: 최근 3년 CB·BW·EB·유상증자·자사주취득 결정 (list.json B001)       (매일, 증분)
 4. 공모 진행: 증권신고서(지분증권) 제출 비상장사 (list.json C001, estkRs)                  (매일)
 5. 회사별 상세: 기업개황, 현금, 최대주주, 임원(대표 나이), 주식총수, 직원, 회사채, 배당, 감사인,
    최대주주 변동, 이벤트 금액 — 오래된 것부터 예산만큼
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

import parse as P
from corpinfo import CorpInfo, CorpInfoError
from dart import BudgetExceeded, Dart, DartError, windows
from marketcap import SOURCE as CAP_SOURCE, CapError, MarketCap

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ANNUAL = "11011"
MARKETS = {"Y": "코스피", "K": "코스닥", "N": "코넥스"}
HOLDER_VERSION = 2  # 최대주주 지분 계산 방식 버전
COMPANY_VERSION = 2  # 기업개황에서 받는 항목 버전 (2: 홈페이지·IR·대표번호 추가)
LST_VERSION = 4  # 상장 예정일 읽는 방식 버전 (2: 청약·납입일 뒤 날짜만 인정, 3: 본문 먼저·일정표 형식, 4: 거래일·30일 안)

log_lines: list[str] = []


def log(s: str) -> None:
    print(s, flush=True)
    log_lines.append(s)


def load(name: str, default):
    p = DATA / name
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return default


def save(name: str, obj) -> None:
    DATA.mkdir(exist_ok=True)
    tmp = DATA / (name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(DATA / name)


def fiscal_year(today: dt.date) -> int:
    """사업보고서가 대부분 나와 있는 최근 사업연도 (3월 말 제출)"""
    return today.year - 1 if today.month >= 4 else today.year - 2


def days_since(iso: str | None, today: dt.date) -> int:
    if not iso:
        return 10**6
    return (today - dt.date.fromisoformat(iso[:10])).days


class TimeUp(Exception):
    pass


class Builder:
    def __init__(self, dart: Dart, corpinfo: CorpInfo | None, today: dt.date):
        self.d = dart
        self.ci = corpinfo
        self.today = today
        self.fy = fiscal_year(today)
        self.state = load("state.json", {})
        self.cos: dict[str, dict] = load("companies.json", {})  # corp_code → 회사 기록(내부용 포함)
        self.events: dict[str, list] = load("events.json", {})  # rcept_no → [corp_code, 날짜, 유형]
        self.ipo: dict[str, dict] = load("ipo_state.json", {})
        self.deadline: float | None = None
        self.mc: MarketCap | None = None

    # 0. 시가총액 (공공데이터포털, DART 호출 아님)
    def market_caps(self) -> None:
        if not self.mc:
            return
        try:
            d, caps = self.mc.latest(self.today)
        except CapError as e:
            log(f"- ⚠️ 시총을 못 받았습니다: {e} (어제 값 유지)")
            return
        n = 0
        for r in self.cos.values():
            v = caps.get(r.get("s", ""))
            r["cap"] = v
            n += v is not None
        self.state["cap_date"] = d
        log(f"- 시총({d[:4]}-{d[4:6]}-{d[6:]} 종가): {n:,}곳")

    # 1. 상장사 목록
    def universe(self) -> None:
        has_lr = all(v.get("lr") for v in self.cos.values() if not v.get("_gone")) if self.cos else False
        if days_since(self.state.get("universe"), self.today) < 7 and self.cos and has_lr:
            return
        seen: dict[str, dict] = {}
        for cls in MARKETS:
            for a, b in windows(self.today - dt.timedelta(days=180), self.today):
                for r in self.d.search(a, b, pblntf_ty="A", corp_cls=cls):
                    if not r.get("stock_code"):
                        continue
                    rec = seen.setdefault(r["corp_code"], {"n": r.get("corp_name", ""), "s": r["stock_code"], "m": cls})
                    per = P.report_period(r.get("report_nm", ""))
                    if per and (not rec.get("lr") or r["rcept_dt"] >= rec["lr"][0]):
                        rec["lr"] = [r["rcept_dt"], r.get("report_nm", ""), r["rcept_no"]]
                        rec["_lrp"] = list(per)
        if len(seen) < 1000:  # 이상하게 적으면 덮어쓰지 않음
            log(f"- ⚠️ 상장사 목록이 {len(seen)}곳뿐이라 갱신하지 않았습니다")
            return
        for code in list(self.cos):
            if code not in seen:
                self.cos[code]["_gone"] = True
        for code, v in seen.items():
            rec = self.cos.setdefault(code, {})
            rec.update(v)
            rec.pop("_gone", None)
        self.state["universe"] = self.today.isoformat()
        log(f"- 상장사 목록: {len(seen):,}곳")

    def active(self) -> list[str]:
        return sorted(c for c, v in self.cos.items() if not v.get("_gone"))

    # 2. 재무 (다중회사)
    def financials(self) -> None:
        key = f"{self.fy}"
        if self.state.get("fin_year") == key and self.state.get("fin_v") == 2 and days_since(self.state.get("fin"), self.today) < 7:
            return
        codes = self.active()
        n = 0
        for i in range(0, len(codes), 100):
            rows = self.d.rows("fnlttMultiAcnt.json", corp_code=",".join(codes[i : i + 100]), bsns_year=self.fy, reprt_code=ANNUAL)
            by_stock = P.multi_financials(rows)
            for c in codes[i : i + 100]:
                f = by_stock.get(self.cos[c].get("s", ""))
                if f:
                    self.cos[c].update({k: f.get(k) for k in ("rev", "op", "ni", "ta", "tl", "te", "opm", "dr")})
                    self.cos[c]["fy"] = self.fy
                    n += 1
        # 사업보고서가 없는 회사(신규상장 등)는 최근 분기·반기 보고서로
        groups: dict[tuple, list[str]] = {}
        for c in codes:
            r = self.cos[c]
            if r.get("fy") == self.fy and not r.get("fyl"):
                continue
            per = r.get("_lrp")
            if per and per[1] != ANNUAL:
                groups.setdefault(tuple(per), []).append(c)
        q = 0
        for (y, code), cs in groups.items():
            for i in range(0, len(cs), 100):
                rows = self.d.rows("fnlttMultiAcnt.json", corp_code=",".join(cs[i : i + 100]), bsns_year=y, reprt_code=code)
                by_stock = P.multi_financials(rows, cumulative=True)
                for c in cs[i : i + 100]:
                    f = by_stock.get(self.cos[c].get("s", ""))
                    if f:
                        self.cos[c].update({k: f.get(k) for k in ("rev", "op", "ni", "ta", "tl", "te", "opm", "dr")})
                        self.cos[c]["fy"] = self.fy
                        self.cos[c]["fyl"] = P.period_label(y, code) + (" · 손익 누적" if code != ANNUAL else "")
                        q += 1
        self.state.update(fin_year=key, fin=self.today.isoformat(), fin_v=2)
        log(f"- 재무({self.fy} 사업보고서): {n:,}곳" + (f", 분기·반기 보고서로 보완: {q:,}곳" if q else ""))

    # 3. 주요사항보고서 이벤트
    def scan_events(self) -> None:
        start = self.today - dt.timedelta(days=3 * 365 + 10)
        until = self.state.get("events_until")
        if until:
            start = max(start, dt.date.fromisoformat(until) - dt.timedelta(days=7))
        added = 0
        for a, b in windows(start, self.today):
            for r in self.d.search(a, b, pblntf_ty="B", pblntf_detail_ty="B001", last_reprt_at="Y"):
                t = P.event_type(r.get("report_nm", ""))
                if t and r["rcept_no"] not in self.events:
                    self.events[r["rcept_no"]] = [r["corp_code"], r["rcept_dt"], t]
                    added += 1
            self.state["events_until"] = b.isoformat()
        cutoff = (self.today - dt.timedelta(days=3 * 365 + 10)).strftime("%Y%m%d")
        self.events = {k: v for k, v in self.events.items() if v[1] >= cutoff}
        log(f"- 주요사항보고서(CB·BW·EB·유증·자사주): 새로 {added}건, 보관 {len(self.events):,}건")

    # 4. 공모 진행 회사
    def scan_ipo(self) -> None:
        start = self.today - dt.timedelta(days=270)
        filers: dict[str, dict] = {}
        for a, b in windows(start, self.today):
            for r in self.d.search(a, b, pblntf_ty="C", pblntf_detail_ty="C001", corp_cls="E"):
                if not P.is_equity_registration(r.get("report_nm", "")):  # 일괄신고서·채무증권 등 제외
                    continue
                f = filers.setdefault(r["corp_code"], {"n": r.get("corp_name", ""), "first": r["rcept_dt"]})
                f["first"] = min(f["first"], r["rcept_dt"])
        for code, f in filers.items():
            rec = self.ipo.setdefault(code, {})
            rec.update(n=f["n"], first=f["first"])
            if days_since(rec.get("_upd"), self.today) < 1 and rec.get("_lsrc") and rec.get("_lsv") == LST_VERSION:
                continue
            reps = self.d.rows("list.json", corp_code=code, bgn_de=f["first"], pblntf_ty="C", page_count=100)
            rec["reports"] = [[r["rcept_dt"], r["report_nm"], r["rcept_no"]] for r in reps]
            info = self.d.get("company.json", corp_code=code)
            rec["cls"] = info.get("corp_cls")
            rec["listed"] = info.get("corp_cls") in MARKETS
            rec["stock"] = info.get("stock_code") or ""
            rec["ceo"] = info.get("ceo_nm")
            rec["ind_code"] = info.get("induty_code")
            rec.update(P.contacts(info))
            data = self.d.get("estkRs.json", corp_code=code, bgn_de=f["first"], end_de=self.today.strftime("%Y%m%d"))
            groups = {g.get("title"): g.get("list") or [] for g in data.get("group", [])} if data else {}
            gen = (groups.get("일반사항") or [{}])[-1]
            kinds = groups.get("증권의종류") or []
            under = groups.get("인수인정보") or []
            rec["sbd"] = P.dates_in(gen.get("sbd", ""))
            rec["pymd"] = (P.dates_in(gen.get("pymd", "")) or [None])[0]
            k = kinds[-1] if kinds else {}
            rec["price"] = P.num(k.get("slprc"))
            rec["total"] = P.eok(k.get("slta"))
            leads = [u.get("actnmn", "").strip() for u in under if "대표" in (u.get("actsen") or "")]
            rec["lead"] = sorted(set(x for x in leads if x)) or sorted(set(u.get("actnmn", "").strip() for u in under if u.get("actnmn")))[:3]
            # 상장 예정일: 최근 투자설명서(없으면 증권신고서) 원문에서, 그 공시가 바뀔 때만 다시 읽음
            prosp = sorted((x for x in rec["reports"] if "투자설명서" in x[1] and "일괄" not in x[1]), key=lambda x: x[0], reverse=True)
            regs = sorted((x for x in rec["reports"] if P.is_equity_registration(x[1])), key=lambda x: x[0], reverse=True)
            docs = prosp[:1] + regs[:1]
            src = ",".join(x[2] for x in docs)
            floor = P.listing_floor(rec["sbd"], rec["pymd"], f["first"])
            if rec.get("lst") and not P.listing_ok(rec["lst"], floor):
                rec["lst"] = None  # 예전 방식으로 잘못 읽은 날짜
            if docs and (rec.get("_lsrc") != src or rec.get("_lsv") != LST_VERSION):
                for x in docs:  # 투자설명서 → 없거나 날짜가 없으면 증권신고서
                    try:
                        found = P.listing_date(self.d.document_text(x[2]), floor)
                    except DartError:
                        found = None
                    if found:
                        rec["lst"] = found
                        break
                rec["_lsrc"] = src
                rec["_lsv"] = LST_VERSION
            rec["_upd"] = self.today.isoformat()
        # 검색에서 빠진 진행 중 회사(상장하면 비상장 검색에서 빠짐) → 기업개황만 다시 확인해 상장 여부 반영
        for code, rec in self.ipo.items():
            if code in filers or rec.get("listed") or days_since(rec.get("_upd"), self.today) < 1:
                continue
            if any("철회" in x[1] for x in rec.get("reports") or []):
                continue
            try:
                info = self.d.get("company.json", corp_code=code)
            except DartError:
                continue
            rec["cls"] = info.get("corp_cls")
            rec["listed"] = info.get("corp_cls") in MARKETS
            rec["stock"] = info.get("stock_code") or rec.get("stock") or ""
            rec.update(P.contacts(info))
            rec["_upd"] = self.today.isoformat()
        # 공모주가 아닌 기록(예전 기준으로 들어온 일괄신고서 등)과 철회·상장 뒤 60일 지난 건 정리
        for code in list(self.ipo):
            r = self.ipo[code]
            not_ipo = r.get("reports") is not None and not any(P.is_equity_registration(x[1]) for x in r["reports"])
            if not_ipo or (code not in filers and (not r.get("sbd") or days_since(r.get("_upd"), self.today) > 60)):
                del self.ipo[code]
        log(f"- 공모(증권신고서 지분증권, 비상장사): {len(filers)}곳")

    # 5. 회사별 상세
    def details(self) -> None:
        codes = self.active()

        def stale(c: str) -> int:
            r = self.cos[c]
            if r.get("_per") != self.fy and (days_since(r.get("_per_try"), self.today) >= 30 or self.can_use_quarter(r)):
                return 0
            if days_since(r.get("_co"), self.today) > 120 or r.get("_cov") != COMPANY_VERSION:
                return 1
            if self.needs_holder_fix(r):
                return 3
            if self.ci and r.get("_crno") and days_since(r.get("_ind"), self.today) > 180:
                return 4  # 업종 이름 아직 없음 (공공데이터포털만 호출, DART 호출 없음)
            if r.get("_evsig") != self.event_sig(c):
                return 2
            return 9

        todo = sorted((stale(c), c) for c in codes)
        todo = [c for s, c in todo if s < 9]
        done = 0
        for c in todo:
            if self.deadline and time.time() > self.deadline:
                raise TimeUp()
            self.detail_one(c)
            done += 1
            if done % 200 == 0:
                self.save_all()
                log(f"  진행 {done:,}/{len(todo):,} (DART 호출 {self.d.calls:,})")
        log(f"- 회사별 상세: {done:,}곳 갱신")

    def can_use_quarter(self, r: dict) -> bool:
        """사업보고서는 없고 최근 분기·반기 보고서가 있으며, 아직 그걸로 시도하지 않은 회사"""
        per = r.get("_lrp")
        return bool(per) and per[1] != ANNUAL and r.get("_qtry") != per

    def needs_holder_fix(self, r: dict) -> bool:
        return r.get("_per") == self.fy and r.get("_mhv") != HOLDER_VERSION and (not r.get("mhr") or r.get("mh") in ("계", "합계", "소계"))

    def event_sig(self, c: str) -> str:
        return ",".join(sorted(k for k, v in self.events.items() if v[0] == c))

    def detail_one(self, c: str) -> None:
        r = self.cos[c]
        if days_since(r.get("_co"), self.today) > 120 or r.get("_cov") != COMPANY_VERSION:
            info = self.d.get("company.json", corp_code=c)
            if info:
                r.update(
                    ceo=info.get("ceo_nm"),
                    est=info.get("est_dt"),
                    acc=info.get("acc_mt"),
                    reg=P.region(info.get("adres")),
                    ind_code=info.get("induty_code"),
                    _crno=info.get("jurir_no"),
                    **P.contacts(info),
                )
            r["_co"] = self.today.isoformat()
            r["_cov"] = COMPANY_VERSION
        if self.ci and r.get("_crno") and days_since(r.get("_ind"), self.today) > 180:
            try:
                r["ind"] = self.ci.industry(r["_crno"]) or r.get("ind")
                r["_ind"] = self.today.isoformat()
            except CorpInfoError as e:
                log(f"  ⚠️ 업종명 조회 중단: {e}")
                self.ci = None
        if r.get("_per") != self.fy and (days_since(r.get("_per_try"), self.today) >= 30 or self.can_use_quarter(r)):
            self.periodic(c, r)
        if self.needs_holder_fix(r):  # 지분 계산 방식 수정(2026-11-20) → 최대주주 현황만 다시 받기
            rows = self.d.rows("hyslrSttus.json", corp_code=c, bsns_year=self.fy, reprt_code=ANNUAL)
            if rows:
                r.update(P.major_holder(rows))
            r["_mhv"] = HOLDER_VERSION
        sig = self.event_sig(c)
        if r.get("_evsig") != sig:
            self.event_amounts(c)
            r["_evsig"] = sig

    def periodic(self, c: str, r: dict) -> None:
        y = self.fy
        q = dict(corp_code=c, bsns_year=y, reprt_code=ANNUAL)
        holders = self.d.rows("hyslrSttus.json", **q)
        if not holders and self.can_use_quarter(r):  # 사업보고서가 없으면 최근 분기·반기 보고서로
            r["_qtry"] = r["_lrp"]
            q = dict(corp_code=c, bsns_year=r["_lrp"][0], reprt_code=r["_lrp"][1])
            holders = self.d.rows("hyslrSttus.json", **q)
            if holders:
                r["perl"] = P.period_label(r["_lrp"][0], r["_lrp"][1])
        if not holders:  # 그 해 사업보고서가 아직 없음 (신규상장 등) → 30일 뒤 다시
            r["_per_try"] = self.today.isoformat()
            return
        r.update(P.major_holder(holders))
        r["_mhv"] = HOLDER_VERSION
        r["age"] = P.ceo_age(self.d.rows("exctvSttus.json", **q), self.today)
        r.update(P.shares(self.d.rows("stockTotqySttus.json", **q)))
        r.update(P.employees(self.d.rows("empSttus.json", **q)))
        r["bond"] = P.bond_balance(self.d.rows("cprndNrdmpBlce.json", **q))
        r["pay"] = P.payout(self.d.rows("alotMatter.json", **q))
        r.update(P.auditor(self.d.rows("accnutAdtorNmNdAdtOpinion.json", **q)))
        chg = self.d.rows("hyslrChgSttus.json", **q)
        r["chg"] = max(len(chg) - 1, 0) if chg else 0
        cash = None
        for fs in ("CFS", "OFS"):
            cash = P.cash_from_statements(self.d.rows("fnlttSinglAcntAll.json", fs_div=fs, **q))
            if cash is not None:
                break
        r["cash"] = cash
        r["_per"] = y

    EVENT_API = {"CB": "cvbdIsDecsn", "BW": "bdwtIsDecsn", "EB": "exbdIsDecsn", "RI": "piicDecsn", "TQ": "tsstkAqDecsn"}

    def event_amounts(self, c: str) -> None:
        mine = {k: v for k, v in self.events.items() if v[0] == c}
        types = sorted({v[2] for v in mine.values()})
        if not types:
            return
        bgn = min(v[1] for v in mine.values())
        amounts: dict[str, int | None] = {}
        for t in types:
            for row in self.d.rows(f"{self.EVENT_API[t]}.json", corp_code=c, bgn_de=bgn, end_de=self.today.strftime("%Y%m%d")):
                if t in ("CB", "BW", "EB"):
                    v = P.eok(row.get("bd_fta"))
                elif t == "RI":
                    parts = [P.num(row.get(f)) for f in ("fdpp_fclt", "fdpp_bsninh", "fdpp_op", "fdpp_dtrp", "fdpp_ocsa", "fdpp_etc")]
                    s = sum(p for p in parts if p)
                    v = round(s / P.EOK) if s else None
                else:
                    s = (P.num(row.get("aqpln_prc_ostk")) or 0) + (P.num(row.get("aqpln_prc_estk")) or 0)
                    v = round(s / P.EOK) if s else None
                amounts[row.get("rcept_no", "")] = v
        for k, v in mine.items():
            if k in amounts:
                self.events[k] = v[:3] + [amounts[k]]

    # 출력
    def save_all(self) -> None:
        save("state.json", self.state)
        save("companies.json", self.cos)
        save("events.json", self.events)
        save("ipo_state.json", self.ipo)

    def outputs(self) -> None:
        y1 = (self.today - dt.timedelta(days=365)).strftime("%Y%m%d")
        by_c: dict[str, list] = {}
        for k, v in self.events.items():
            by_c.setdefault(v[0], []).append([v[1], v[2], k, v[3] if len(v) > 3 else None])
        rows = []
        for c in self.active():
            r = self.cos[c]
            ev = sorted(by_c.get(c, []), reverse=True)
            agg = {}
            for t in ("MZ", "RI", "TQ"):
                pick = [e for e in ev if (e[1] in ("CB", "BW", "EB") if t == "MZ" else e[1] == t) and (t != "TQ" or e[0] >= y1)]
                amts = [e[3] for e in pick if e[3] is not None]
                agg[t] = [len(pick), sum(amts) if amts else None, pick[0][0] if pick else None] if pick else None
            out = {k: v for k, v in r.items() if not k.startswith("_") and v is not None}
            out["c"] = c
            out["mz"], out["ri"], out["tq"] = agg["MZ"], agg["RI"], agg["TQ"]
            out["evl"] = ev[:12]
            out["ind"] = r.get("ind") or (f"업종코드 {r['ind_code']}" if r.get("ind_code") else None)
            rows.append({k: v for k, v in out.items() if v not in (None, [], "")})
        rows.sort(key=lambda x: x.get("n", ""))
        save("listed.json", rows)

        ipo_rows = []
        for c, r in self.ipo.items():
            names = [x[1] for x in r.get("reports", [])]
            if names and not any(P.is_equity_registration(n) for n in names):
                continue
            floor = P.listing_floor(r.get("sbd"), r.get("pymd"), r.get("first"))
            lst = r.get("lst") if P.listing_ok(r.get("lst"), floor) else None
            stage = P.ipo_stage(self.today, names, bool(r.get("listed")), r.get("sbd") or [], lst)
            last = max(r.get("reports") or [["", "", ""]], key=lambda x: x[0])
            ipo_rows.append({
                "c": c, "n": r.get("n"), "stage": stage, "first": r.get("first"), "sbd": r.get("sbd"),
                "pymd": r.get("pymd"), "price": r.get("price"), "total": r.get("total"), "lead": r.get("lead"),
                "ceo": r.get("ceo"), "s": r.get("stock"), "spac": ("스팩" in (r.get("n") or "")) or ("기업인수목적" in (r.get("n") or "")),
                "lst": lst, "hm": r.get("hm"), "ir": r.get("ir"), "tel": r.get("tel"), "rc": last[2], "reports": sorted(r.get("reports") or [], reverse=True)[:8],
            })
        ipo_rows.sort(key=lambda x: (x.get("sbd") or ["9999"])[0])
        save("ipo.json", ipo_rows)

        total = len(self.active())
        done = sum(1 for c in self.active() if self.cos[c].get("_per") == self.fy)
        save("meta.json", {
            "updated": dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m-%d %H:%M"),
            "cap_date": self.state.get("cap_date"), "cap_source": CAP_SOURCE,
            "fy": self.fy, "listed": total, "detail_done": done, "ipo": len(ipo_rows), "dart_calls": self.d.calls,
        })


def main() -> int:
    key = os.environ.get("DART_API_KEY", "").strip()
    if not key:
        print("DART_API_KEY 비밀값이 없습니다")
        return 1
    budget = int(os.environ.get("DART_DAILY_BUDGET", "11000"))
    gokr = os.environ.get("DATA_GO_KR_KEY", "").strip()
    today = dt.date.today()
    b = Builder(Dart(key, budget), CorpInfo(gokr) if gokr else None, today)
    t0 = time.time()
    b.deadline = t0 + int(os.environ.get("MAX_MINUTES", "230")) * 60
    b.mc = MarketCap(gokr) if gokr else None
    steps = [b.universe, b.market_caps, b.financials, b.scan_events, b.scan_ipo, b.details]
    for step in steps:
        try:
            step()
        except BudgetExceeded:
            log(f"- 오늘 호출 예산({budget:,}회)을 다 써서 여기까지 하고 다음 실행 때 이어서 합니다")
            break
        except TimeUp:
            log("- 실행 시간이 길어져 여기까지 저장하고 다음 실행 때 이어서 합니다")
            break
        except DartError as e:
            log(f"- ⚠️ {step.__name__} 중 오류: {e} (다음 단계로 넘어감)")
        finally:
            b.save_all()
    b.outputs()
    log(f"- DART 호출 {b.d.calls:,}회, {int(time.time() - t0)}초")
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write("# 법인 DB 갱신\n\n" + "\n".join(log_lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
