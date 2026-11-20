"""업종명: 공공데이터포털 금융위원회_기업기본정보 getCorpOutline_V2 (이용허락범위: 제한 없음, 2026-11-14 확인).

요청: ServiceKey, resultType=json, crno(법인등록번호 13자리) / 응답 item.sicNm(표준산업분류명)
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2"


class CorpInfoError(Exception):
    pass


class CorpInfo:
    def __init__(self, key: str):
        self.key = urllib.parse.unquote(key.strip())
        self.calls = 0

    def industry(self, crno: str) -> str | None:
        crno = "".join(ch for ch in crno or "" if ch.isdigit())
        if len(crno) != 13:
            return None
        q = urllib.parse.urlencode({"ServiceKey": self.key, "resultType": "json", "crno": crno, "numOfRows": 10, "pageNo": 1})
        self.calls += 1
        try:
            with urllib.request.urlopen(f"{API}?{q}", timeout=60) as r:
                raw = r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:  # URL(키 포함)은 출력하지 않고, 포털의 오류 이유만 보여 줌
            body = e.read().decode("utf-8", errors="replace")
            m = re.search(r'"returnAuthMsg"\s*:\s*"([^"]+)"', body) or re.search(r"<returnAuthMsg>([^<]+)<", body)
            raise CorpInfoError(f"HTTP {e.code}" + (f" {m.group(1)}" if m else "")) from None
        except urllib.error.URLError as e:
            raise CorpInfoError(f"접속 실패: {e.reason}") from None
        finally:
            time.sleep(0.1)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            raise CorpInfoError("응답을 읽지 못함 (인증키·활용신청 확인)") from None
        res = data.get("response", {})
        if res.get("header", {}).get("resultCode") != "00":
            raise CorpInfoError(f"결과 코드 {res.get('header', {}).get('resultCode')}")
        items = ((res.get("body") or {}).get("items") or {}).get("item") or []
        items = items if isinstance(items, list) else [items]
        items = [i for i in items if (i.get("sicNm") or "").strip()]
        if not items:
            return None
        items.sort(key=lambda i: str(i.get("lastOpegDt") or ""), reverse=True)
        return items[0]["sicNm"].strip()
