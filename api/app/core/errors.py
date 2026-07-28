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


class InvalidRequest(DipeatError):
    """요청 본문이 형식에 맞지 않는 경우(예: /menu/locate 의 targets JSON 파싱 실패·빈 목록)."""

    status_code = 422
    code = "invalid_request"
    message = "요청 형식이 올바르지 않아요."


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


class NoMenuFound(UnreadableMenu):
    """사진에 메뉴판이 아예 없다고 모델이 스스로 판정한 경우(빈 벽, 어두운 프레임, 음식 사진…).

    ⚠️ 이건 '읽기 실패'가 아니라 **환각 방지 장치**다. 이 분기가 없으면 모델이 빈 사진에도
    그럴듯한 메뉴판을 통째로 지어내고(실측: 흰 화면 → 8개, 회색 → 8개, 어두운 프레임 → 5개),
    사용자는 그 가짜 메뉴를 점원에게 보여주게 된다. items 가 0개일 때만 도는 기존 가드는
    모델이 항목을 채워 보내므로 절대 걸리지 않는다.

    `UnreadableMenu` 를 상속하는 이유: 재시도·폴백 분기를 **그대로 타야 한다.** 어두운 실사
    메뉴판을 오판할 수 있으므로 상위 모델에게 한 번 더 물어본 뒤에 사용자에게 알린다.
    """

    code = "no_menu_found"
    message = "사진에서 메뉴판을 찾지 못했어요. 메뉴판 글자가 잘 보이게 다시 찍어주세요."


class UnsupportedAudio(DipeatError):
    """오디오가 아니거나 비어 있는 업로드. 이미지 오류(UnsupportedImage)와 구분해,
    음성 실패에 JPEG/PNG 안내가 뜨지 않게 한다."""

    status_code = 415
    code = "unsupported_audio"
    message = "지원하지 않는 오디오 형식이에요."


class AudioTooLarge(DipeatError):
    """녹음이 너무 길다. 과대 이미지(PayloadTooLarge)와 같은 413 이지만 오디오 문구를 쓴다."""

    status_code = 413
    code = "audio_too_large"
    message = "녹음이 너무 길어요. 짧게 말해주세요."


class UnclearAudio(DipeatError):
    """모델이 오디오는 받았으나 알아듣지 못한 경우(짧거나 소음). 입력 거절(415/413)과 구분된다."""

    status_code = 422
    code = "unclear_audio"
    message = "잘 안 들렸어요. 다시 말해주세요."
