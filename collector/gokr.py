"""공공데이터포털 호출 공통 (재시도·오류 이유 정리). 키가 담긴 URL은 어디에도 출력하지 않는다."""

from __future__ import annotations

import re
import socket
import time
import urllib.error
import urllib.request


class PortalError(Exception):
    pass


def fetch(url: str, timeout: int = 60, tries: int = 3) -> str:
    """응답 본문(문자열). 접속 지연·시간 초과는 잠시 쉬고 다시 시도, 인증 오류(4xx)는 바로 알림."""
    last = ""
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            m = re.search(r'"returnAuthMsg"\s*:\s*"([^"]+)"', body) or re.search(r"<returnAuthMsg>([^<]+)<", body)
            last = f"HTTP {e.code}" + (f" {m.group(1)}" if m else "")
            if e.code < 500:
                raise PortalError(last) from None
        except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
            last = f"접속 실패: {getattr(e, 'reason', e)}"
        time.sleep(10 * (attempt + 1))
    raise PortalError(last + f" ({tries}번 시도)")
