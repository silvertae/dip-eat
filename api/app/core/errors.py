"""도메인 예외. 라우터가 아니라 서비스 계층에서 던지고, main.py 의 핸들러가 HTTP 로 매핑한다."""


class DipeatError(Exception):
    """모든 도메인 예외의 베이스."""

    status_code = 500
    code = "internal_error"
    message = "알 수 없는 오류가 발생했어요."

    def __init__(self, message: str | None = None, *, detail: str | None = None):
        self.message = message or self.message
        self.detail = detail
        super().__init__(self.message)


class PayloadTooLarge(DipeatError):
    status_code = 413
    code = "payload_too_large"
    message = "사진 용량이 너무 커요. 조금 더 작게 찍어주세요."


class UnsupportedImage(DipeatError):
    status_code = 415
    code = "unsupported_image"
    message = "지원하지 않는 이미지 형식이에요. JPEG·PNG·WEBP 로 올려주세요."


class UpstreamTimeout(DipeatError):
    status_code = 504
    code = "upstream_timeout"
    message = "메뉴판을 읽는 데 시간이 너무 오래 걸렸어요. 다시 시도해주세요."


class UpstreamError(DipeatError):
    status_code = 502
    code = "upstream_error"
    message = "메뉴 인식 서비스에 문제가 있어요. 잠시 후 다시 시도해주세요."


class UpstreamRateLimited(DipeatError):
    status_code = 429
    code = "upstream_rate_limited"
    message = "요청이 몰리고 있어요. 잠시 후 다시 시도해주세요."


class UpstreamConfigError(DipeatError):
    """API 키·권한·요청 형식 문제. 재시도해도 똑같이 실패하므로 폴백 모델도 시도하지 않는다."""

    status_code = 502
    code = "upstream_config_error"
    message = "메뉴 인식 서비스 설정에 문제가 있어요. 잠시 후 다시 시도해주세요."


class UnreadableMenu(DipeatError):
    """모델이 호출은 성공했으나 스키마에 맞는 결과를 내지 못한 경우."""

    status_code = 422
    code = "unreadable_menu"
    message = "메뉴판을 읽지 못했어요. 글자가 잘 보이게 다시 찍어주세요."


class UnclearAudio(DipeatError):
    """음성을 알아듣지 못한 경우(짧거나 소음)."""

    status_code = 422
    code = "unclear_audio"
    message = "잘 안 들렸어요. 다시 말해주세요."
