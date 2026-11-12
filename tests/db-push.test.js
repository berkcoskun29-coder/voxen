import { describe, it, expect } from 'vitest'
import { buildPushArgs } from '../scripts/db-push-lib.mjs'

describe('buildPushArgs', () => {
  it('özel karakterli URL değişmeden tek argüman olarak kalır', () => {
    const url = 'postgresql://postgres:p&a%s^s|w@db.x.supabase.co:5432/postgres?sslmode=require&a=b'
    expect(buildPushArgs(url)).toEqual(['db', 'push', '--db-url', url])
  })
})
