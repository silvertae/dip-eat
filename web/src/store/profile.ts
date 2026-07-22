import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AllergenCode } from '../types/api'

/** 프로필은 이 기기에만 저장된다 — 서버로 나가지 않는다.
 *  알레르기 대조도 클라이언트에서 하므로 프로필을 바꿔도 재스캔이 필요 없다. */
export interface Profile {
  allergies: AllergenCode[]
  /** 알레르기가 아닌 취향(고수·양고기…). 응답 스키마에 재료 정보가 없어서 목록 필터에는
   *  쓰지 않고, 주문 카드의 "고수 빼주세요" 메모(Phase 4)에 쓴다. */
  dislikes: string[]
  vegetarian: boolean
  /** 원 단위. 0 이면 '설정 안 함'으로 보고 예산 게이지를 숨긴다. */
  tripBudget: number
  restaurantBudget: number
  onboarded: boolean
}

interface ProfileState extends Profile {
  toggleAllergy: (code: AllergenCode) => void
  toggleDislike: (key: string) => void
  setVegetarian: (on: boolean) => void
  setBudget: (which: 'trip' | 'restaurant', amount: number) => void
  finishOnboarding: () => void
  resetProfile: () => void
}

const INITIAL: Profile = {
  allergies: [],
  dislikes: [],
  vegetarian: false,
  tripBudget: 300_000,
  restaurantBudget: 30_000,
  onboarded: false,
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      ...INITIAL,
      toggleAllergy: (code) => set((s) => ({ allergies: toggle(s.allergies, code) })),
      toggleDislike: (key) => set((s) => ({ dislikes: toggle(s.dislikes, key) })),
      setVegetarian: (on) => set({ vegetarian: on }),
      setBudget: (which, amount) =>
        set(which === 'trip' ? { tripBudget: amount } : { restaurantBudget: amount }),
      finishOnboarding: () => set({ onboarded: true }),
      resetProfile: () => set({ ...INITIAL }),
    }),
    { name: 'dipeat:profile', version: 1 },
  ),
)
