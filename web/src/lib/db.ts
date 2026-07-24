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
import type { MenuScanResponse } from '../types/api'

/** 프로필(localStorage 'dipeat:profile')·세션(localStorage 'dipeat:session')과 별개의 DB. */
const recentsStore = createStore('dipeat', 'recents')

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
}

/** N개를 넘으면 오래된 것부터 지운다. */
async function prune(): Promise<void> {
  const all = await listRecents()
  for (const entry of all.slice(MAX_RECENTS)) {
    await del(entry.scanId, recentsStore)
  }
}
