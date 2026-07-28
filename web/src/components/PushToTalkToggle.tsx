import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type Recording,
  VoicePermissionError,
  VoiceUnsupportedError,
  releaseMic,
  startRecording,
} from '../features/voice/recorder'
import { ApiError } from '../lib/api'
import { useApp } from '../store/app'

type Dir = 'me' | 'them'

/** 목업의 push-to-talk 세그먼트 토글.
 *  탭 = 언어 포커스 전환(썸 슬라이드), 홀드(>170ms) = 녹음 → 떼면 전송.
 *  녹음 중엔 소나 링 + 이퀄라이저, 반대 반쪽은 딤 처리.
 *
 *  홀드 방향 → 번역 방향: '나' = ko2local(내 한국어→일본어), '점원' = local2ko. */
const HOLD_MS = 170

export function PushToTalkToggle({ sourceLang }: { sourceLang: string }) {
  const sendVoice = useApp((s) => s.sendVoice)
  const [voiceDir, setVoiceDir] = useState<Dir>('me')
  const [recording, setRecording] = useState<Dir | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recorder = useRef<Recording | null>(null)
  const starting = useRef(false) // getUserMedia 진행 중(권한 프롬프트 대기 포함)

  // 화면 떠나면 전부 정리한다. releaseMic() 만으로는 부족하다 —
  // 홀드 타이머가 살아 있으면 언마운트 뒤에 begin() 이 발화해 '다른 화면에서' 권한 프롬프트가 뜨고,
  // 그 마이크를 반납할 주체가 사라져 세션 내내 켜진 채로 남는다.
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current)
      starting.current = false // 진행 중인 begin() 이 스스로 rec.cancel() 하게 만든다
      recorder.current?.cancel()
      recorder.current = null
      releaseMic()
    },
    [],
  )

  const begin = useCallback(async (dir: Dir) => {
    starting.current = true
    setError('')
    try {
      const rec = await startRecording()
      if (!starting.current) {
        rec.cancel() // getUserMedia 도중 손을 뗐다
        return
      }
      recorder.current = rec
      setRecording(dir)
    } catch (err) {
      starting.current = false
      setRecording(null)
      setError(
        err instanceof VoicePermissionError || err instanceof VoiceUnsupportedError
          ? err.message
          : '녹음을 시작하지 못했어요.',
      )
    }
  }, [])

  const pressStart = (dir: Dir) => {
    setVoiceDir(dir)
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => void begin(dir), HOLD_MS)
  }

  const pressEnd = async (dir: Dir) => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    starting.current = false
    const rec = recorder.current
    if (!rec) return // 짧은 탭(녹음 시작 전) — 언어 전환만 하고 끝
    recorder.current = null
    setRecording(null)
    setBusy(true)
    try {
      const blob = await rec.stop()
      if (blob.size < 900) return // 너무 짧음 — 조용히 무시
      await sendVoice(blob, dir === 'me' ? 'ko2local' : 'local2ko', sourceLang)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '전송하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    starting.current = false
    recorder.current?.cancel()
    recorder.current = null
    setRecording(null)
  }

  const thumbLeft = voiceDir === 'me' ? '5px' : 'calc(50% + 2px)'
  const thumbAnim =
    recording === 'me'
      ? 'jm-rec 1.15s ease-out infinite'
      : recording === 'them'
        ? 'jm-recD 1.15s ease-out infinite'
        : 'none'

  return (
    <div>
      {error && <p className="mb-2 text-center text-[11px] text-brand-700">{error}</p>}

      <div
        className="relative flex h-[60px] touch-none select-none rounded-[17px] bg-[#F1E6DA] p-[5px]"
      >
        {/* sliding thumb */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-[5px] z-[1] rounded-[13px] bg-white"
          style={{
            width: 'calc(50% - 7px)',
            left: thumbLeft,
            transform: recording ? 'scale(1.03)' : 'scale(1)',
            boxShadow: '0 4px 12px -3px rgba(60,25,10,.25)',
            animation: thumbAnim,
            transition:
              'left .36s cubic-bezier(.34,1.56,.64,1), transform .14s ease, box-shadow .2s',
          }}
        />

        <Half
          dir="me"
          active={voiceDir === 'me'}
          recording={recording === 'me'}
          dimmed={recording === 'them'}
          disabled={busy}
          chip="한"
          chipFont=""
          label="나 · 한국어"
          idleHint="🎙 꾹 눌러 말하기"
          barColor="var(--color-brand)"
          hintColor={voiceDir === 'me' ? 'text-brand-700' : 'text-[#b0a094]'}
          onStart={pressStart}
          onEnd={pressEnd}
          onCancel={cancel}
        />
        <Half
          dir="them"
          active={voiceDir === 'them'}
          recording={recording === 'them'}
          dimmed={recording === 'me'}
          disabled={busy}
          chip="日"
          chipFont="font-local"
          label="점원 · 日本語"
          idleHint="🎙 꾹 눌러 듣기"
          barColor="var(--color-ink)"
          hintColor={voiceDir === 'them' ? 'text-ink' : 'text-[#b0a094]'}
          onStart={pressStart}
          onEnd={pressEnd}
          onCancel={cancel}
        />
      </div>

      {busy && <p className="mt-2 text-center text-[11px] text-muted">번역하는 중…</p>}
    </div>
  )
}

function Half({
  dir,
  active,
  recording,
  dimmed,
  disabled,
  chip,
  chipFont,
  label,
  idleHint,
  barColor,
  hintColor,
  onStart,
  onEnd,
  onCancel,
}: {
  dir: Dir
  active: boolean
  recording: boolean
  dimmed: boolean
  disabled: boolean
  chip: string
  chipFont: string
  label: string
  idleHint: string
  barColor: string
  hintColor: string
  onStart: (dir: Dir) => void
  onEnd: (dir: Dir) => void
  onCancel: () => void
}) {
  const chipBg = active ? (dir === 'me' ? 'bg-brand' : 'bg-ink') : 'bg-[#E3D6C6]'
  const chipColor = active ? 'text-white' : 'text-[#8A7266]'
  const labelColor = active ? (dir === 'me' ? 'text-ink' : 'text-ink') : 'text-[#9c8677]'

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e) => {
        // 캡처는 손이 버튼 밖으로 나가도 pointerup 을 받기 위한 것. 일부 환경에서 던지므로 감싼다.
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* 무시 — 캡처 실패해도 녹음 자체엔 지장 없다 */
        }
        onStart(dir)
      }}
      onPointerUp={() => onEnd(dir)}
      onPointerLeave={onCancel}
      onPointerCancel={onCancel}
      onContextMenu={(e) => e.preventDefault()}
      className="relative z-[2] flex flex-1 touch-none flex-col items-center justify-center gap-[3px] transition-opacity duration-200"
      style={{ opacity: dimmed ? 0.4 : 1 }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`grid size-[22px] place-items-center rounded-full text-[11px] font-extrabold transition-all duration-200 ${chipBg} ${chipColor} ${chipFont}`}
        >
          {chip}
        </span>
        <span className={`text-[13px] font-extrabold transition-colors duration-200 ${labelColor}`}>
          {label}
        </span>
      </div>

      {recording ? (
        <div className="flex h-[13px] items-center gap-[5px]">
          <span className="flex h-[13px] items-end gap-[2px]">
            {[0, 0.18, 0.34, 0.1].map((delay, i) => (
              <span
                key={i}
                className="w-[3px] origin-bottom rounded-[2px]"
                style={{
                  height: '100%',
                  background: barColor,
                  animation: `jm-eq .7s ease-in-out ${delay}s infinite`,
                }}
              />
            ))}
          </span>
          <span
            className="text-[10px] font-extrabold"
            style={{ color: barColor }}
          >
            {dir === 'me' ? '듣는 중…' : '듣는 中…'}
          </span>
        </div>
      ) : (
        <span className={`text-[10px] font-bold transition-colors duration-200 ${hintColor}`}>
          {idleHint}
        </span>
      )}
    </button>
  )
}
