from __future__ import annotations

import io

import pytest
from PIL import Image

from app.core.errors import UnsupportedImage
from app.services.image import prepare_image
from tests.conftest import make_jpeg

PREP = {"target_long_edge": 2048, "jpeg_quality": 85}


def test_downscales_to_target_long_edge():
    raw = make_jpeg(4032, 3024)  # 아이폰 12MP 세로 비율
    out = prepare_image(raw, **PREP)
    assert max(out.width, out.height) == 2048
    assert out.width / out.height == pytest.approx(4032 / 3024, rel=1e-2)
    assert out.mime_type == "image/jpeg"


def test_small_image_is_not_upscaled():
    out = prepare_image(make_jpeg(300, 200), **PREP)
    assert (out.width, out.height) == (300, 200)


def test_png_is_accepted_and_converted_to_jpeg():
    buf = io.BytesIO()
    Image.new("RGBA", (100, 100), (10, 20, 30, 255)).save(buf, format="PNG")
    out = prepare_image(buf.getvalue(), **PREP)
    assert out.mime_type == "image/jpeg"
    assert Image.open(io.BytesIO(out.data)).format == "JPEG"


def test_rejects_non_image_bytes():
    with pytest.raises(UnsupportedImage):
        prepare_image(b"not an image at all", **PREP)


def test_rejects_decompression_bomb():
    """작은 파일이 거대한 픽셀로 펼쳐지는 것을 막는다. 업로드 바이트 상한으로는 못 막는다 —
    작은 파일로 큰 픽셀을 만드는 게 압축폭탄의 정의다. 이게 없으면 동시 8건이 2Gi 를 넘겨
    컨테이너가 OOM 되고 **진행 중이던 정상 스캔들이 함께 죽는다**."""
    buf = io.BytesIO()
    # 단색이라 압축이 극단적으로 잘 된다: 40Mpx 가 수십 KB.
    Image.new("RGB", (8000, 5000), (255, 255, 255)).save(buf, format="PNG")
    bomb = buf.getvalue()
    assert len(bomb) < 200_000, "폭탄 픽스처가 작아야 바이트 상한으로 못 막는다는 점이 성립한다"
    with pytest.raises(UnsupportedImage):
        prepare_image(bomb, **PREP)


def test_accepts_full_resolution_phone_photo():
    """⚠️ MAX_IMAGE_PIXELS 를 더 내리면 여기서 걸린다. 클라이언트가 축소해 보내지만
    워커 실패 시 메인스레드 폴백이 있고 이 API 는 공개다 — 폰 원본은 받아야 한다."""
    out = prepare_image(make_jpeg(4032, 3024), **PREP)
    assert max(out.width, out.height) == 2048


def test_rejects_empty_body():
    with pytest.raises(UnsupportedImage):
        prepare_image(b"", **PREP)


def test_rejects_disallowed_format_even_if_pillow_can_read_it():
    """content_type 이 아니라 실제로 디코드된 format 으로 판단하는지."""
    buf = io.BytesIO()
    Image.new("RGB", (50, 50)).save(buf, format="BMP")
    with pytest.raises(UnsupportedImage):
        prepare_image(buf.getvalue(), **PREP)


def test_strips_exif_metadata():
    """GPS 등이 붙은 사진을 그대로 흘려보내지 않는지."""
    out = prepare_image(make_jpeg(800, 600), **PREP)
    assert not Image.open(io.BytesIO(out.data)).getexif()
