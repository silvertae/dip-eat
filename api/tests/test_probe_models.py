"""모델 교체 전에 probe가 현재 후보를 확인하도록 고정한다."""

from scripts.probe_models import CANDIDATES


def test_probe_includes_latest_flash_candidate():
    assert "gemini-3.7-flash" in CANDIDATES
