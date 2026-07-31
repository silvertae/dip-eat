import { describe, expect, it } from 'vitest'
import { migrateProfile } from './profile'

describe('profile persistence migration', () => {
  it('preserves v1 KRW budgets and initializes Japanese defaults', () => {
    const migrated = migrateProfile(
      { tripBudget: 450_000, restaurantBudget: 45_000, onboarded: true },
      1,
    ) as {
      travelerLang: string
      budgets: {
        KRW: { trip: number; restaurant: number }
        JPY: { trip: number; restaurant: number }
      }
    }

    expect(migrated.travelerLang).toBe('ko')
    expect(migrated.budgets.KRW).toEqual({ trip: 450_000, restaurant: 45_000 })
    expect(migrated.budgets.JPY).toEqual({ trip: 100_000, restaurant: 10_000 })
  })
})
