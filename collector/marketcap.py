"""시가총액: 공공데이터포털 금융위원회_주식시세정보 (data.go.kr/data/15094808).

공식 명세 (2026-11-10 확인)
- GET https://apis.data.go.kr/1160100/GetStockSecuritiesInfoService_V2/getStockPriceInfo_V2
- 요청: serviceKey, resultType=json, numOfRows, pageNo, basDt(YYYYMMDD)
- 응답 item: basDt, srtnCd(단축코드), mrktTotAmt(종가×상장주식수), clpr(종가), lstgStCnt(상장주식수)
- 하루 1회 갱신 (기준일 다음 영업일 13시 이후)
- 이용조건: 공공누리 제4유형(출처표시·상업적 이용금지·변경금지). 공개 페이지 게시는 사용자 결정(2026-11-20).
  화면에 출처와 기준일을 표시한다.
"""

from __future__ import annotations

import datetime as dt
import json
import time
import urllib.parse

from gokr import PortalError, fetch

API = "https://apis.data.go.kr/1160100/GetStockSecuritiesInfoService_V2/getStockPriceInfo_V2"
SOURCE = "금융위원회 주식시세정보(공공데이터포털)"
EOK = 100_000_000


class CapError(Exception):
    pass


class MarketCap:
    def __init__(self, key: str):
        self.key = urllib.parse.unquote(key.strip())
        self.calls = 0

    def _get(self, params: dict) -> dict:
        q = urllib.parse.urlencode({"serviceKey": self.key, "resultType": "json", **params})
        self.calls += 1
        try:
            raw = fetch(f"{API}?{q}", timeout=90)
        except PortalError as e:
            raise CapError(str(e)) from None
        finally:
            time.sleep(0.2)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            raise CapError("응답을 읽지 못함") from None
        res = data.get("response", {})
        if res.get("header", {}).get("resultCode") != "00":
            raise CapError(f"결과 코드 {res.get('header', {}).get('resultCode')}")
        return res.get("body", {})

    @staticmethod
    def _items(body: dict) -> list[dict]:
        items = (body.get("items") or {}).get("item") or []
        return items if isinstance(items, list) else [items]

    def latest(self, today: dt.date) -> tuple[str, dict[str, int]]:
        """가장 최근 기준일과 {종목코드: 시총(억원)}"""
        for back in range(1, 15):
            d = (today - dt.timedelta(days=back)).strftime("%Y%m%d")
            body = self._get({"basDt": d, "numOfRows": 1, "pageNo": 1})
            if int(body.get("totalCount") or 0) > 0:
                return d, self.caps(d)
        raise CapError("최근 2주 시세 데이터가 없습니다")

    def caps(self, bas_dt: str) -> dict[str, int]:
        out: dict[str, int] = {}
        page = 1
        while True:
            body = self._get({"basDt": bas_dt, "numOfRows": 1000, "pageNo": page})
            items = self._items(body)
            out.update(parse_caps(items))
            if not items or page * 1000 >= int(body.get("totalCount") or 0) or page >= 10:
                return out
            page += 1


def parse_caps(items: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for it in items:
        code = str(it.get("srtnCd") or "").strip().upper()
        if len(code) == 7 and code.startswith("A"):
            code = code[1:]
        try:
            amt = float(it.get("mrktTotAmt"))
        except (TypeError, ValueError):
            continue
        if code:
            out[code] = round(amt / EOK)
    return out
