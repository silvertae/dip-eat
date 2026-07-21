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
