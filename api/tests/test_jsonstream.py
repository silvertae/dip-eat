"""증분 JSON 파서 테스트.

이 파서가 틀리면 증상이 "메뉴가 몇 개 안 나온다" 로만 보이고 원인을 찾기 어렵다.
그래서 **경계 조건을 조각 경계에 일부러 걸쳐서** 테스트한다.
"""

from __future__ import annotations

import json

import pytest

from app.services.jsonstream import MenuStreamParser

FULL = json.dumps(
    {
        "source_lang": "ja",
        "currency": "JPY",
        "restaurant": {"name_local": "炭火焼鳥 ゑんや", "cuisine_hint": "야키토리"},
        "items": [
            {"name_local": "かわ", "price_text": "150円"},
            {"name_local": "レバー", "price_text": "150円"},
            {"name_local": "ねぎま", "price_text": "150円"},
        ],
        "warnings": ["오른쪽이 잘렸어요"],
    },
    ensure_ascii=False,
)


def names(raws: list[str]) -> list[str]:
    return [json.loads(r)["name_local"] for r in raws]


def test_extracts_items_when_fed_in_one_go():
    parser = MenuStreamParser()
    assert names(parser.feed(FULL)) == ["かわ", "レバー", "ねぎま"]


@pytest.mark.parametrize("size", [1, 3, 7, 17, 64])
def test_extracts_the_same_items_at_every_chunk_size(size):
    """조각 경계가 어디에 떨어지든 결과가 같아야 한다.

    size=1 은 한 글자씩 — 객체 중간, 문자열 중간, 이스케이프 중간에서 전부 잘린다.
    """
    parser = MenuStreamParser()
    got: list[str] = []
    for i in range(0, len(FULL), size):
        got += parser.feed(FULL[i : i + size])
    assert names(got) == ["かわ", "レバー", "ねぎま"]


def test_head_is_available_before_any_item_completes():
    """meta(가게 이름·통화)를 첫 항목보다 먼저 알 수 있어야 화면을 빨리 그린다."""
    parser = MenuStreamParser()
    prefix = FULL[: FULL.index('"items"') + len('"items": [')]
    parser.feed(prefix)

    assert parser.head is not None
    assert parser.head["source_lang"] == "ja"
    assert parser.head["currency"] == "JPY"
    assert parser.head["restaurant"]["name_local"] == "炭火焼鳥 ゑんや"


def test_braces_inside_strings_do_not_break_object_boundaries():
    """설명 문구에 중괄호가 들어와도 원소 경계를 잘못 잡으면 안 된다."""
    payload = json.dumps(
        {
            "source_lang": "ja",
            "items": [
                {"name_local": "A", "summary": "중괄호 { 와 } 가 든 설명"},
                {"name_local": "B", "summary": '따옴표 \\" 와 역슬래시 \\\\ 도'},
            ],
        },
        ensure_ascii=False,
    )
    parser = MenuStreamParser()
    got: list[str] = []
    for ch in payload:  # 한 글자씩
        got += parser.feed(ch)
    assert names(got) == ["A", "B"]


def test_nested_arrays_inside_an_item_are_not_mistaken_for_the_end():
    """tags/allergens 는 배열이다. 그 안의 ']' 를 items 종료로 오인하면 안 된다."""
    payload = json.dumps(
        {
            "items": [
                {"name_local": "A", "tags": ["spicy", "raw"], "allergens": []},
                {"name_local": "B", "tags": [], "allergens": ["egg"]},
            ]
        },
        ensure_ascii=False,
    )
    parser = MenuStreamParser()
    assert names(parser.feed(payload)) == ["A", "B"]
    assert parser.items_closed


def test_partial_trailing_object_is_not_emitted_until_complete():
    """절반만 온 항목을 내보내면 프런트가 깨진 카드를 그린다."""
    parser = MenuStreamParser()
    head = '{"source_lang":"ja","items":[{"name_local":"かわ"'
    assert parser.feed(head) == []
    assert parser.feed(',"price_text":"150円"}') != []


def test_items_closed_flags_the_end_of_the_array():
    parser = MenuStreamParser()
    parser.feed(FULL)
    assert parser.items_closed is True


def test_no_items_key_yields_nothing_and_does_not_crash():
    """모델이 스키마를 어겨 items 자체가 없을 수 있다. 조용히 0개여야 한다
    (그 경우를 에러로 올릴지는 호출부가 정한다 — response.parsed 가드의 대체물)."""
    parser = MenuStreamParser()
    assert parser.feed('{"source_lang":"ja","warnings":[]}') == []
    assert parser.head is None


def test_items_appearing_as_a_string_value_is_not_mistaken_for_the_key():
    """가게 이름에 'items' 가 들어가도 키로 오인하면 안 된다."""
    payload = json.dumps(
        {"restaurant": {"name_local": 'the "items" bar'}, "items": [{"name_local": "A"}]},
        ensure_ascii=False,
    )
    parser = MenuStreamParser()
    assert names(parser.feed(payload)) == ["A"]


def test_buffer_keeps_everything_for_a_final_full_parse():
    """스트리밍이 끝나면 전체를 다시 검증해 warnings 를 얻고 무결성을 확인한다."""
    parser = MenuStreamParser()
    for i in range(0, len(FULL), 11):
        parser.feed(FULL[i : i + 11])
    assert json.loads(parser.buffer)["warnings"] == ["오른쪽이 잘렸어요"]
