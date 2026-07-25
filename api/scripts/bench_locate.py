#!/usr/bin/env python
"""'사진에서 확인'(3단계 /menu/locate)의 정확도 게이트 스크립트.

    uv run python scripts/bench_locate.py ../samples
    uv run python scripts/bench_locate.py ../samples/japanese_menu2.jpg -n 6

각 사진을 스캔해 실제 항목을 얻고, 앞에서 몇 개를 '장바구니'로 골라 locate_items 를 호출한다.
반환 박스를 사진 위에 그려 docs/bench/locate-<stamp>.html 로 남긴다 — 브라우저로 열어
상자가 실제 메뉴 항목에 얹히는지 사람이 눈으로 확인하는 것이 이 스크립트의 목적이다.
(정답 좌표가 없으니 자동 채점은 못 한다. found 비율만 수치로 남긴다.)
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import html
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import Settings  # noqa: E402
from app.core.errors import DipeatError  # noqa: E402
from app.schemas.menu import LocateTarget  # noqa: E402
from app.services.gemini import GeminiService  # noqa: E402
from app.services.image import prepare_image  # noqa: E402

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


async def run_one(service: GeminiService, image_bytes: bytes, mode: str, max_targets: int) -> dict:
    prepared = prepare_image(image_bytes, target_long_edge=2048, jpeg_quality=85)
    try:
        scan = await service.extract_menu(prepared, mode=mode)
    except DipeatError as exc:
        return {"ok": False, "stage": "scan", "error": f"{exc.code}: {exc.detail or exc.message}"}

    items = scan.extraction.items[:max_targets]
    targets = [
        LocateTarget(index=i + 1, name_local=it.name_local, section=it.section)
        for i, it in enumerate(items)
    ]

    started = time.perf_counter()
    try:
        loc = await service.locate_items(prepared, targets)
    except DipeatError as exc:
        return {"ok": False, "stage": "locate", "error": f"{exc.code}: {exc.detail or exc.message}"}
    latency_ms = int((time.perf_counter() - started) * 1000)

    boxes = [
        {
            "index": b.index,
            "name_local": b.name_local,
            "found": b.found,
            # 0~1000 → 0~1 (라우트와 동일 변환)
            "x": min(1.0, max(0.0, b.xmin / 1000.0)),
            "y": min(1.0, max(0.0, b.ymin / 1000.0)),
            "w": max(0.0, min(1.0, b.xmax / 1000.0) - min(1.0, b.xmin / 1000.0)),
            "h": max(0.0, min(1.0, b.ymax / 1000.0) - min(1.0, b.ymin / 1000.0)),
        }
        for b in loc.result.boxes
    ]
    found = sum(1 for b in boxes if b["found"])
    return {
        "ok": True,
        "latency_ms": latency_ms,
        "targets": len(targets),
        "found": found,
        "model": loc.model,
        "tok_in": loc.usage.input_tokens,
        "tok_out": loc.usage.output_tokens,
        "img_b64": base64.b64encode(prepared.data).decode(),
        "px": prepared.px,
        "boxes": boxes,
        "names": {t.index: t.name_local for t in targets},
    }


def render_html(rows: list[dict]) -> str:
    """사진 위에 박스를 얹은 검수용 HTML. 컨테이너를 이미지 종횡비 그대로 두어(=cover 크롭 없음)
    Gemini 좌표 자체의 정확도만 본다. cover 변환은 프런트에서 별도 검증(photoOverlay)."""
    blocks = []
    for r in rows:
        title = html.escape(r["file"])
        if not r["ok"]:
            blocks.append(f'<section><h2>{title}</h2><p class="err">❌ {html.escape(r["stage"])}: '
                          f'{html.escape(r["error"])}</p></section>')
            continue
        markers = []
        legend = []
        for b in r["boxes"]:
            name = html.escape(r["names"].get(b["index"], b["name_local"]))
            if b["found"]:
                markers.append(
                    f'<div class="box" style="left:{b["x"]*100:.2f}%;top:{b["y"]*100:.2f}%;'
                    f'width:{b["w"]*100:.2f}%;height:{b["h"]*100:.2f}%">'
                    f'<span class="num">{b["index"]}</span>'
                    f'<span class="lbl">{name}</span></div>'
                )
                legend.append(f'<li><b>{b["index"]}</b> {name} '
                              f'<code>x{b["x"]:.2f} y{b["y"]:.2f} w{b["w"]:.2f} h{b["h"]:.2f}</code></li>')
            else:
                legend.append(f'<li class="miss"><b>{b["index"]}</b> {name} — 못 찾음</li>')
        blocks.append(
            f'<section><h2>{title} <small>{r["found"]}/{r["targets"]} found · '
            f'{r["model"]} · {r["latency_ms"]}ms · {r["px"]}</small></h2>'
            f'<div class="wrap"><img src="data:image/jpeg;base64,{r["img_b64"]}">'
            f'{"".join(markers)}</div><ol class="legend">{"".join(legend)}</ol></section>'
        )
    return (
        "<!doctype html><meta charset=utf-8><title>locate probe</title><style>"
        "body{font:14px system-ui;margin:24px;background:#faf6f0;color:#241512}"
        "section{margin-bottom:40px}h2 small{font-weight:400;color:#8a7266;font-size:12px}"
        ".wrap{position:relative;display:inline-block;max-width:520px;border-radius:12px;overflow:hidden}"
        ".wrap img{display:block;width:100%}"
        ".box{position:absolute;border:2px solid #ea5a34;background:rgba(234,90,52,.24);"
        "border-radius:6px;box-sizing:border-box}"
        ".num{position:absolute;left:-11px;top:-11px;width:22px;height:22px;border-radius:50%;"
        "background:#ea5a34;color:#fff;font-size:12px;font-weight:800;display:grid;place-items:center}"
        ".lbl{position:absolute;left:0;bottom:100%;background:#241512;color:#fff;font-size:11px;"
        "padding:1px 5px;border-radius:4px;white-space:nowrap}"
        ".legend{max-width:520px;color:#4a3a30}.legend .miss{color:#b3261e}"
        ".legend code{color:#8a7266;font-size:11px}.err{color:#b3261e}"
        "</style>" + "".join(blocks)
    )


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="사진 디렉터리 또는 단일 파일")
    parser.add_argument("-n", "--max-targets", type=int, default=6, help="이미지당 대상 항목 수(장바구니 흉내)")
    parser.add_argument("--mode", default="poster", choices=["poster", "booklet", "kiosk"])
    args = parser.parse_args()

    if args.path.is_dir():
        images = sorted(p for p in args.path.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    else:
        images = [args.path]
    if not images:
        print(f"❌ {args.path} 에 이미지가 없습니다.", file=sys.stderr)
        return 1

    settings = Settings()
    if not settings.resolved_api_key:
        print("❌ GEMINI_API_KEY 가 없습니다. api/.env 를 확인하세요.", file=sys.stderr)
        return 1
    service = GeminiService(settings)

    print(f"사진 {len(images)}장 · 이미지당 최대 {args.max_targets}개 대상\n")
    rows = []
    for path in images:
        row = await run_one(service, path.read_bytes(), args.mode, args.max_targets)
        row["file"] = path.name
        rows.append(row)
        if row["ok"]:
            print(f"   {path.name:28} {row['found']}/{row['targets']} found  "
                  f"{row['model']:22} out {row['tok_out']:>4}  {row['latency_ms']:>6}ms")
        else:
            print(f"   {path.name:28} ❌ {row['stage']}: {row['error'][:60]}")

    ok = [r for r in rows if r["ok"]]
    if ok:
        tot_t = sum(r["targets"] for r in ok)
        tot_f = sum(r["found"] for r in ok)
        print(f"\n총 found 비율: {tot_f}/{tot_t} = {tot_f / tot_t:.0%}  "
              f"(★ 비율은 참고일 뿐, HTML 을 열어 상자가 맞는 항목에 얹혔는지 눈으로 확인)")

    out_dir = Path(__file__).resolve().parent.parent.parent / "docs" / "bench"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    out_path = out_dir / f"locate-{stamp}.html"
    out_path.write_text(render_html(rows), encoding="utf-8")
    print(f"\n📄 {out_path}\n   브라우저로 열어 정확도 확인.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
