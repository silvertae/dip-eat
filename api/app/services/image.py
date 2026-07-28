"""이미지 검증/정규화. FastAPI 를 import 하지 않는다(순수 로직 → 단위 테스트 쉬움)."""

from __future__ import annotations

import io
import warnings

from PIL import Image, ImageOps

from app.core.errors import UnsupportedImage

# 클라이언트가 canvas 로 다시 인코딩해 보내므로 이 셋이면 충분하다.
# (iOS 도 <input type=file> 경로에서는 보통 JPEG 로 변환해 넘긴다)
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

# None 으로 두면 압축폭탄 방어가 통째로 꺼진다 — 절대 금지.
#
# 16Mpx 로 조인 이유: 60Mpx 는 '폰 카메라가 48Mpx 니까' 로 잡은 값인데, 방어 대상은
# 폰 사진이 아니라 압축폭탄이다. 60Mpx 는 exif_transpose + convert("RGB") 사본까지
# ~360MB 이고 --concurrency 8 --memory 2Gi 에서 8개가 겹치면 ~2.9GB → OOM →
# **진행 중이던 정상 스캔 8건이 함께 죽는다**(docs/deploy.md 5.1·12장).
# 업로드 바이트 상한은 방어가 안 된다 — 작은 파일로 큰 픽셀을 만드는 게 압축폭탄의 정의다.
#
# ⚠️ 8Mpx 까지 내리면 안 된다. 폰 원본(4032×3024 = 12.2Mpx)이 거절된다 —
# 클라이언트가 축소해 보내지만 워커 실패 시 메인스레드 폴백이 있고, 이 API 는 공개다.
# 16Mpx 면 그 경로는 그대로 살면서 최악 상황 메모리가 ~1.2GB 로 내려간다.
# (tests/test_image.py 와 test_upload_limits.py 가 12.2Mpx 통과를 지킨다.)
Image.MAX_IMAGE_PIXELS = 16_000_000


class PreparedImage:
    __slots__ = ("data", "mime_type", "width", "height")

    def __init__(self, data: bytes, mime_type: str, width: int, height: int):
        self.data = data
        self.mime_type = mime_type
        self.width = width
        self.height = height

    @property
    def px(self) -> str:
        return f"{self.width}x{self.height}"


def prepare_image(raw: bytes, *, target_long_edge: int, jpeg_quality: int) -> PreparedImage:
    """업로드 바이트를 검증하고 Gemini 에 보낼 JPEG 으로 정규화한다.

    블로킹 CPU 작업이므로 호출부에서 반드시 `run_in_threadpool` 로 감쌀 것.
    """
    if not raw:
        raise UnsupportedImage("이미지가 비어 있어요.")

    # 압축폭탄 경고를 예외로 승격. Pillow 는 MAX_IMAGE_PIXELS 의 2배까지는 '경고'만 한다.
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            # verify() 는 객체를 무효화하므로, 검사용으로 한 번 열고 버린다.
            with Image.open(io.BytesIO(raw)) as probe:
                fmt = probe.format
                probe.verify()
        except UnsupportedImage:
            raise
        except Exception as exc:  # PIL 은 다양한 예외를 던진다
            raise UnsupportedImage(detail=f"{type(exc).__name__}: {exc}") from exc

        # 클라이언트가 보낸 content_type 은 신뢰하지 않는다. 실제로 디코드된 format 만 믿는다.
        if fmt not in ALLOWED_FORMATS:
            raise UnsupportedImage(detail=f"format={fmt}")

        # verify() 이후에는 반드시 새 BytesIO 로 다시 연다.
        with Image.open(io.BytesIO(raw)) as img:
            # 직접 업로드(curl 등) 대비. 브라우저 경로는 이미 픽셀에 회전이 구워져 있어 무해하다.
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")

            long_edge = max(img.size)
            if long_edge > target_long_edge:
                scale = target_long_edge / long_edge
                new_size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
                img = img.resize(new_size, Image.Resampling.LANCZOS)

            out = io.BytesIO()
            # exif 를 넘기지 않으므로 GPS 등 메타데이터가 자동으로 제거된다.
            img.save(out, format="JPEG", quality=jpeg_quality, optimize=True)
            return PreparedImage(out.getvalue(), "image/jpeg", img.width, img.height)
