"""OpenDART 호출 (opendart.fss.or.kr 개발가이드 확인, 2026-11-17).

- 호출 수를 세고 `budget`을 넘으면 BudgetExceeded 를 던진다 (CRM과 하루 한도를 나눠 쓰기 때문).
- 키·URL은 어디에도 출력하지 않는다 (공개 저장소의 Actions 로그는 누구나 볼 수 있음).
결과 코드: 000 정상, 013 데이터 없음, 020 요청 제한 초과, 그 밖은 오류.
"""

from __future__ import annotations

import datetime as dt
import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

API = "https://opendart.fss.or.kr/api"


class DartError(Exception):
    pass


class BudgetExceeded(Exception):
    pass


class Dart:
    def __init__(self, key: str, budget: int):
        self.key = key
        self.budget = budget
        self.calls = 0

    def _raw(self, path: str, params: dict) -> bytes:
        if self.calls >= self.budget:
            raise BudgetExceeded()
        q = urllib.parse.urlencode({"crtfc_key": self.key, **params})
        self.calls += 1
        for attempt in range(3):
            try:
                with urllib.request.urlopen(f"{API}/{path}?{q}", timeout=60) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                if attempt == 2:
                    raise DartError(f"HTTP {e.code}") from None
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt == 2:
                    raise DartError(f"접속 실패: {getattr(e, 'reason', e)}") from None
            time.sleep(2 * (attempt + 1))
        raise DartError("응답 없음")

    def get(self, path: str, **params) -> dict:
        """JSON API. 데이터 없음(013)은 빈 dict."""
        data = json.loads(self._raw(path, params).decode("utf-8"))
        st = data.get("status")
        if st == "000":
            return data
        if st == "013":
            return {}
        if st == "020":
            raise BudgetExceeded()
        raise DartError(f"{path} 결과 코드 {st}")

    def rows(self, path: str, **params) -> list[dict]:
        return self.get(path, **params).get("list") or []

    # ── 고유번호 파일 ──
    def corp_codes(self) -> dict[str, dict]:
        raw = self._raw("corpCode.xml", {})
        if not raw.startswith(b"PK"):
            raise DartError("고유번호 파일을 받지 못했습니다")
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            root = ET.fromstring(zf.read(zf.namelist()[0]))
        out = {}
        for it in root.iter("list"):
            code = (it.findtext("corp_code") or "").strip()
            out[code] = {
                "name": (it.findtext("corp_name") or "").strip(),
                "stock": (it.findtext("stock_code") or "").strip(),
            }
        return out

    # ── 공시검색 (corp_code 없이는 3개월 제한 → 구간 나눠서) ──
    def search(self, bgn: dt.date, end: dt.date, **params) -> list[dict]:
        out: list[dict] = []
        page = 1
        while True:
            d = self.get(
                "list.json",
                bgn_de=bgn.strftime("%Y%m%d"),
                end_de=end.strftime("%Y%m%d"),
                page_no=page,
                page_count=100,
                **params,
            )
            out.extend(d.get("list") or [])
            if not d or page >= int(d.get("total_page") or 1):
                return out
            page += 1


def windows(start: dt.date, end: dt.date, days: int = 89) -> list[tuple[dt.date, dt.date]]:
    """start~end 를 3개월(89일) 이하 구간으로 나눔 (오래된 것부터)"""
    out = []
    cur = start
    while cur <= end:
        nxt = min(cur + dt.timedelta(days=days), end)
        out.append((cur, nxt))
        cur = nxt + dt.timedelta(days=1)
    return out
