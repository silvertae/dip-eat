const REVIEW_API_SUFFIX = '---dipeat-api-178327258666.asia-northeast3.run.app'

type BuildEnvironment = Record<string, string | undefined>

/**
 * 운영은 Vercel rewrite(`/api` → Cloud Run)를 그대로 쓴다.
 * PR Preview만 같은 PR 번호의 Cloud Run tag URL을 직접 호출한다.
 */
export function resolveApiOrigin(env: BuildEnvironment): string {
  const explicit = env.VITE_API_ORIGIN?.trim().replace(/\/+$/, '')
  if (explicit) return explicit

  if (env.VERCEL_ENV !== 'preview') return ''

  // 포크 PR은 GCP OIDC를 주지 않아 review backend를 만들지 않는다.
  const repoOwner = env.VERCEL_GIT_REPO_OWNER?.trim()
  if (repoOwner && repoOwner !== 'silvertae') return ''

  const pullRequest = env.VERCEL_GIT_PULL_REQUEST_ID?.trim()
  // PR이 생기기 전 branch preview는 운영 API를 사용한다.
  if (!pullRequest) return ''
  if (!/^\d+$/.test(pullRequest)) {
    throw new Error(`Invalid VERCEL_GIT_PULL_REQUEST_ID: ${pullRequest}`)
  }

  return `https://pr-${pullRequest}${REVIEW_API_SUFFIX}`
}
