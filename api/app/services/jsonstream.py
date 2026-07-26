"""완성되지 않은 JSON 에서 완성된 배열 원소만 꺼내는 증분 파서.

Gemini 는 `response_schema` 를 줘도 응답을 조각내서 보낸다(실측: 505개 청크 / 34KB).
그 조각들은 그 자체로는 유효한 JSON 이 아니라서 `json.loads` 를 붙일 수 없다.
하지만 `items` 배열의 원소는 **순서대로 완성**되므로, 완성된 원소만 골라내면
전체 생성이 끝나기 전에 카드를 그릴 수 있다.

실측 근거 (samples/ 10장):

| 메뉴판 | 항목 수 | 첫 항목 | 전체 |
|---|---|---|---|
| menu2 | 20개 | 1.55초 | 10.18초 |
| menu1 | 40개 | 2.70초 | 19.05초 |
| menu5 | 54개 | 2.78초 | 26.11초 |

첫 항목 도착이 메뉴 크기와 거의 무관하다 — 큰 메뉴판일수록 이득이 크다.

이 모듈은 **순수 문자열 처리**다. Gemini 도 FastAPI 도 모른다. 그래서 테스트가 쉽고,
깨지면 `tests/test_jsonstream.py` 가 정확히 짚어준다.
"""

from __future__ import annotations

import json
import re
from typing import Any

# `"items"` 가 문자열 값 안에 우연히 들어 있을 수 있으므로(가게 이름 등)
# 키 위치에 있는 것만 잡는다: "items" 뒤에 : 와 [ 가 오는 형태.
_ITEMS_KEY = re.compile(r'"items"\s*:\s*\[')


class MenuStreamParser:
    """조각을 먹여주면 완성된 항목의 원본 JSON 문자열을 돌려준다.

    쓰는 쪽:

        parser = MenuStreamParser()
        for chunk in stream:
            for raw in parser.feed(chunk):
                item = MenuItemSummary.model_validate_json(raw)   # 검증은 호출부에서
        head = parser.head        # source_lang / currency / restaurant
        full = parser.buffer      # 끝나고 통째로 재검증할 때
    """

    def __init__(self) -> None:
        self._buf = ""
        self._cursor: int | None = None  # items 배열 '[' 바로 다음 위치
        self._scanned = 0  # 여기까지는 이미 원소를 꺼냈다
        self._head: dict[str, Any] | None = None
        self.items_closed = False

    # --- 읽기 전용 ---------------------------------------------------------

    @property
    def buffer(self) -> str:
        return self._buf

    @property
    def head(self) -> dict[str, Any] | None:
        """`items` 앞에 오는 필드들(source_lang / currency / restaurant).

        스키마 필드 순서상 이것들이 항목보다 먼저 완성된다. 아직 못 읽었으면 None.
        """
        return self._head

    # --- 먹이기 ------------------------------------------------------------

    def feed(self, chunk: str) -> list[str]:
        """조각을 붙이고, **이번에 새로 완성된** 원소들의 원본 JSON 을 반환한다."""
        if not chunk:
            return []
        self._buf += chunk

        if self._cursor is None:
            match = _ITEMS_KEY.search(self._buf)
            if match is None:
                return []  # 아직 items 배열이 시작도 안 됐다
            self._cursor = self._scanned = match.end()
            self._head = _parse_head(self._buf[: match.start()])

        if self.items_closed:
            return []

        found: list[str] = []
        for start, end in self._complete_objects():
            found.append(self._buf[start:end])
            self._scanned = end
        return found

    # --- 내부 -------------------------------------------------------------

    def _complete_objects(self) -> list[tuple[int, int]]:
        """`_scanned` 이후에서 깊이 0으로 닫힌 객체들의 [시작, 끝) 을 찾는다.

        문자열 안의 중괄호에 속지 않도록 따옴표와 이스케이프를 추적한다 —
        메뉴명에 `{` 가 들어올 일은 드물지만, 설명 문구에는 충분히 들어올 수 있다.
        """
        out: list[tuple[int, int]] = []
        i = self._scanned
        depth = 0
        in_str = False
        escaped = False
        obj_start: int | None = None

        while i < len(self._buf):
            c = self._buf[i]
            if in_str:
                if escaped:
                    escaped = False
                elif c == "\\":
                    escaped = True
                elif c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c == "{":
                if depth == 0:
                    obj_start = i
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0 and obj_start is not None:
                    out.append((obj_start, i + 1))
                    obj_start = None
            elif c == "]" and depth == 0:
                # 배열이 닫혔다. 이후 텍스트(warnings 등)는 여기서 보지 않는다.
                self.items_closed = True
                break
            i += 1

        return out


def _parse_head(prefix: str) -> dict[str, Any] | None:
    """`items` 앞부분만 떼어 유효한 JSON 으로 만들어 읽는다.

    `{"source_lang":"ja","currency":"JPY","restaurant":{...},` 까지 온 상태이므로
    끝의 쉼표를 떼고 `}` 로 닫아주면 파싱된다.
    """
    head = prefix.rstrip().removesuffix(",")
    try:
        parsed = json.loads(head + "}")
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None
