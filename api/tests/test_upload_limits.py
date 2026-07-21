"""업로드 크기 상한 회귀 테스트.

`app/core/limits.py` 의 몽키패치가 Starlette 업그레이드로 깨지면 여기서 잡힌다.
`test_accepts_upload_larger_than_starlette_default_part_size` 가 실패하면
`Request.form` / `_get_form` 시그니처가 바뀐 것이다.
"""

from __future__ import annotations

from tests.conftest import FakeGemini, make_jpeg


async def test_accepts_upload_larger_than_starlette_default_part_size(client_factory):
    """Starlette 기본 max_part_size 는 1MB. 실제 사진은 그보다 크다."""
    big = make_jpeg(2200, 1600, noise=True)
    assert len(big) > 1024 * 1024, f"픽스처가 1MB 를 못 넘음: {len(big)}"

    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/menu/scan",
            files={"image": ("menu.jpg", big, "image/jpeg")},
            data={"mode": "poster"},
        )
    assert resp.status_code == 200, resp.text


async def test_rejects_body_over_total_limit(client_factory, monkeypatch):
    from app.core.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("DIPEAT_MAX_UPLOAD_BYTES", "200000")
    get_settings.cache_clear()

    try:
        big = make_jpeg(1600, 1200, noise=True)
        assert len(big) > 200_000
        async with client_factory() as client:
            resp = await client.post(
                "/api/v1/menu/scan",
                files={"image": ("menu.jpg", big, "image/jpeg")},
            )
        assert resp.status_code == 413
        assert resp.json()["code"] == "payload_too_large"
    finally:
        get_settings.cache_clear()


async def test_unsupported_image_maps_to_415(client_factory):
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/menu/scan",
            files={"image": ("menu.jpg", b"definitely not a jpeg", "image/jpeg")},
        )
    assert resp.status_code == 415
    assert resp.json()["code"] == "unsupported_image"


async def test_missing_file_is_422(client_factory):
    async with client_factory() as client:
        resp = await client.post("/api/v1/menu/scan", data={"mode": "poster"})
    assert resp.status_code == 422


async def test_image_is_downscaled_before_reaching_gemini(client_factory):
    fake = FakeGemini()
    big = make_jpeg(4032, 3024)
    async with client_factory(fake) as client:
        resp = await client.post(
            "/api/v1/menu/scan", files={"image": ("m.jpg", big, "image/jpeg")}
        )
    assert resp.status_code == 200
    assert fake.calls[0]["px"] == "2048x1536"
    assert fake.calls[0]["bytes"] < len(big)
