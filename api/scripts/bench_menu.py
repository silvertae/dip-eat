#!/usr/bin/env python
"""실사진으로 모델·설정을 A/B 하는 Phase 1 게이트 스크립트.

    uv run python scripts/bench_menu.py ../samples
    uv run python scripts/bench_menu.py ../samples -m gemini-3.1-flash-lite -m gemini-3.5-flash
    uv run python scripts/bench_menu.py ../samples --no-media-resolution --thinking minimal

정확도는 사람이 눈으로 봐야 하므로(정답 메뉴판이 없으니) 이 스크립트는 '판단 근거'를 모은다:
항목 수, 가격 파싱률, 저확신 비율, 지연시간, 그리고 읽어낸 메뉴명 전체.
결과 JSON 은 docs/bench/ 에 남겨 발표 자료로 쓴다.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import Settings  # noqa: E402
from app.core.errors import DipeatError  # noqa: E402
from app.services.gemini import GeminiService  # noqa: E402
from app.services.image import prepare_image  # noqa: E402

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


async def run_one(service: GeminiService, image_bytes: bytes, model: str, mode: str) -> dict:
    prepared = prepare_image(image_bytes, target_long_edge=2048, jpeg_quality=85)
    started = time.perf_counter()
    try:
        outcome = await service.extract_menu(prepared, mode=mode, models=[model])
    except DipeatError as exc:
        return {"ok": False, "error": f"{exc.code}: {exc.detail or exc.message}"}

    latency_ms = int((time.perf_counter() - started) * 1000)
    extraction = outcome.extraction
    items = extraction.items
    priced = [i for i in items if i.price_amount is not None]
    low_conf = [i for i in items if i.ocr_confidence != "high"]

    return {
        "ok": True,
        "latency_ms": latency_ms,
        "items": len(items),
        "price_parse_rate": round(len(priced) / len(items), 3) if items else 0.0,
        "low_confidence": len(low_conf),
        "with_allergens": sum(1 for i in items if i.likely_allergens),
        "sent_kb": round(len(prepared.data) / 1024),
        "tok_in": outcome.input_tokens,
        "tok_out": outcome.output_tokens,
        "tok_think": outcome.thought_tokens,
        "ms_per_item": round(latency_ms / len(items)) if items else 0,
        "restaurant": extraction.restaurant.name_local,
        "warnings": extraction.warnings,
        # 정확도는 결국 사람이 본다. 읽어낸 원문/번역/가격을 그대로 남긴다.
        "read": [
            {
                "local": i.name_local,
                "ko": i.name_translated,
                "price": i.price_text,
                "conf": i.ocr_confidence,
            }
            for i in items
        ],
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image_dir", type=Path, help="실제 메뉴판 사진이 든 디렉터리")
    parser.add_argument(
        "-m", "--model", dest="models", action="append",
        help="비교할 모델 ID (여러 번 지정 가능). 기본: 설정의 1차 + 폴백",
    )
    parser.add_argument("--mode", default="poster", choices=["poster", "booklet", "kiosk"])
    parser.add_argument("--thinking", default=None, help="minimal|low|medium|high")
    parser.add_argument(
        "--no-media-resolution", action="store_true",
        help="media_resolution 을 보내지 않는다(미지원 모델에서 400 이 날 때)",
    )
    args = parser.parse_args()

    images = sorted(p for p in args.image_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    if not images:
        print(f"❌ {args.image_dir} 에 이미지가 없습니다.", file=sys.stderr)
        return 1

    overrides: dict = {}
    if args.thinking:
        overrides["gemini_thinking_level"] = args.thinking
    if args.no_media_resolution:
        overrides["gemini_media_resolution"] = ""
    settings = Settings(**overrides)

    if not settings.resolved_api_key:
        print("❌ GEMINI_API_KEY 가 없습니다. api/.env 를 확인하세요.", file=sys.stderr)
        return 1

    service = GeminiService(settings)
    models = args.models or [settings.gemini_model, settings.gemini_model_fallback]

    print(f"사진 {len(images)}장 × 모델 {len(models)}개 = {len(images) * len(models)}회 호출")
    print(f"thinking={settings.gemini_thinking_level} "
          f"media_resolution={settings.gemini_media_resolution or '(미전송)'}\n")

    results: dict[str, list[dict]] = {}
    for model in models:
        print(f"── {model}")
        rows = []
        for path in images:
            row = await run_one(service, path.read_bytes(), model, args.mode)
            row["file"] = path.name
            rows.append(row)
            if row["ok"]:
                print(f"   {path.name:28} {row['items']:3}개  "
                      f"가격 {row['price_parse_rate']:.0%}  "
                      f"저확신 {row['low_confidence']}  "
                      f"in {row['tok_in']:>5} out {row['tok_out']:>6} think {row['tok_think']:>5}  "
                      f"{row['latency_ms']:>6}ms")
            else:
                print(f"   {path.name:28} ❌ {row['error'][:70]}")
        results[model] = rows
        print()

    print("=" * 78)
    print(f"{'모델':<28} {'성공':>6} {'평균항목':>8} {'가격파싱':>8} {'p50':>7} {'p95':>7}")
    print("-" * 78)
    for model, rows in results.items():
        ok = [r for r in rows if r["ok"]]
        if not ok:
            print(f"{model:<28} {0:>6} {'-':>8} {'-':>8} {'-':>7} {'-':>7}")
            continue
        lat = sorted(r["latency_ms"] for r in ok)
        p95 = lat[min(len(lat) - 1, int(len(lat) * 0.95))]
        print(
            f"{model:<28} {len(ok)}/{len(rows):>4} "
            f"{statistics.mean(r['items'] for r in ok):>8.1f} "
            f"{statistics.mean(r['price_parse_rate'] for r in ok):>7.0%} "
            f"{statistics.median(lat):>6}ms {p95:>6}ms"
        )
    print("=" * 78)
    print("\n⚠️  항목 수가 많다고 좋은 게 아니다. 아래 JSON 의 `read` 를 실제 메뉴판과")
    print("    직접 대조해 누락과 환각을 확인할 것.")

    out_dir = Path(__file__).resolve().parent.parent.parent / "docs" / "bench"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    out_path = out_dir / f"bench-{stamp}.json"
    out_path.write_text(
        json.dumps(
            {
                "generated_at": stamp,
                "mode": args.mode,
                "thinking_level": settings.gemini_thinking_level,
                "media_resolution": settings.gemini_media_resolution,
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n📄 {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
