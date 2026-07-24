/** 최근 식당 저장소 — IndexedDB(idb-keyval).
 *
 *  스캔 결과(JSON)와 촬영본 축소 이미지(Blob)를 최근 N개만 남긴다. 목적은 두 가지:
 *  - 홈의 "최근 식당" 재열람 — 오프라인에서도 지난 메뉴판을 다시 본다.
 *  - 새로고침/PWA 재실행 뒤 세션 복원(활성 스캔은 store 의 persist 가, 이미지 Blob 은 여기서).
 *
 *  ⚠️ 사진은 절대 localStorage(iOS ~5MB 상한, base64 33% 팽창)에 넣지 않는다 — Blob 그대로 IDB.
 *  ⚠️ 원본(3~5MB)이 아니라 **업로드용 축소본(~350~700KB)** 을 저장한다. 썸네일·재열람엔 충분하고
 *     기기 용량을 아낀다.
 */

import { createStore, del, get, set, values } from 'idb-keyval'
import type { ItemBox, MenuScanResponse } from '../types/api'

/** 프로필(localStorage 'dipeat:profile')·세션(localStorage 'dipeat:session')과 별개의 DB. */
const recentsStore = createStore('dipeat', 'recents')
/** '사진에서 확인' 좌표 캐시. 항목 좌표는 수량과 무관하므로 scan_id 별로 itemKey→박스 로 쌓는다.
 *  ⚠️ idb-keyval 은 한 DB 에 스토어를 하나만 만든다(버전 업그레이드를 안 하므로 두 번째 스토어는
 *  생성되지 않는다). 그래서 recents 와 같은 DB('dipeat')가 아니라 **별도 DB** 를 쓴다. */
const locatesStore = createStore('dipeat-locates', 'locates')

export interface RecentScan {
  scanId: string
  savedAt: number
  scan: MenuScanResponse
  /** 업로드용 축소 JPEG. 오프라인·프라이빗 모드 등으로 저장 못 하면 null. */
  image: Blob | null
}

/** 12개면 홈에서 훑기 충분하고, 각 항목이 최대 ~700KB 라 용량도 수 MB 안쪽. */
const MAX_RECENTS = 12

/** 스캔 성공 시 호출. 같은 scan_id 를 다시 넣으면 갱신된다(재스캔=최신으로). */
export async function putRecent(scan: MenuScanResponse, image: Blob | null): Promise<void> {
  const entry: RecentScan = { scanId: scan.scan_id, savedAt: Date.now(), scan, image }
  await set(scan.scan_id, entry, recentsStore)
  await prune()
}

/** 최신순. 홈 목록이 쓴다. */
export async function listRecents(): Promise<RecentScan[]> {
  const all = (await values(recentsStore)) as RecentScan[]
  return all.sort((a, b) => b.savedAt - a.savedAt)
}

export async function getRecent(scanId: string): Promise<RecentScan | undefined> {
  return (await get(scanId, recentsStore)) as RecentScan | undefined
}

export async function removeRecent(scanId: string): Promise<void> {
  await del(scanId, recentsStore)
  await del(scanId, locatesStore) // 형제 좌표 캐시도 함께 정리
}

/** '사진에서 확인' 좌표 캐시 읽기(itemKey → 박스). 없으면 빈 객체. */
export async function getLocates(scanId: string): Promise<Record<string, ItemBox>> {
  return ((await get(scanId, locatesStore)) as Record<string, ItemBox> | undefined) ?? {}
}

/** 새로 찾은 좌표를 기존 캐시에 병합해 저장. 이미 찾은 항목은 재호출하지 않으려는 것. */
export async function mergeLocates(scanId: string, add: Record<string, ItemBox>): Promise<void> {
  const prev = await getLocates(scanId)
  await set(scanId, { ...prev, ...add }, locatesStore)
}

/** N개를 넘으면 오래된 것부터 지운다. */
async function prune(): Promise<void> {
  const all = await listRecents()
  for (const entry of all.slice(MAX_RECENTS)) {
    await del(entry.scanId, recentsStore)
  }
}
