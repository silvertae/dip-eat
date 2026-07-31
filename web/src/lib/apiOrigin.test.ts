import { describe, expect, it } from 'vitest'
import { resolveApiOrigin } from '../../build/api-origin'

describe('resolveApiOrigin', () => {
  it('keeps production on the same-origin Vercel rewrite', () => {
    expect(resolveApiOrigin({ VERCEL_ENV: 'production' })).toBe('')
  })

  it('targets the Cloud Run tag matching the Vercel PR preview', () => {
    expect(
      resolveApiOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_GIT_REPO_OWNER: 'silvertae',
        VERCEL_GIT_PULL_REQUEST_ID: '30',
      }),
    ).toBe('https://pr-30---dipeat-api-178327258666.asia-northeast3.run.app')
  })

  it('keeps a branch preview without a PR on the production API', () => {
    expect(resolveApiOrigin({ VERCEL_ENV: 'preview' })).toBe('')
  })

  it('does not target a privileged review backend for fork PRs', () => {
    expect(
      resolveApiOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_GIT_REPO_OWNER: 'someone-else',
        VERCEL_GIT_PULL_REQUEST_ID: '30',
      }),
    ).toBe('')
  })

  it('allows an explicit local or emergency override', () => {
    expect(resolveApiOrigin({ VITE_API_ORIGIN: 'http://127.0.0.1:8000/' })).toBe(
      'http://127.0.0.1:8000',
    )
  })

  it('rejects malformed pull request ids before they enter a hostname', () => {
    expect(() =>
      resolveApiOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_GIT_PULL_REQUEST_ID: '30.example.com',
      }),
    ).toThrow('Invalid VERCEL_GIT_PULL_REQUEST_ID')
  })
})
