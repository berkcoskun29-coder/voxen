// Sunucu sessize alma (mutes.js): server_mutes tablosu, Set dönüşü, tekrar eklemede hata yok.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/lib/supabase.js', () => {
  fake.sorgular = []
  fake.sonuc = { data: [], error: null }
  fake.from = (tablo) => {
    const s = { tablo, cagrilar: [] }
    for (const ad of ['select', 'insert', 'delete', 'eq']) {
      s[ad] = (...a) => { s.cagrilar.push([ad, ...a]); return s }
    }
    s.then = (ok, hata) => Promise.resolve(fake.sonuc).then(ok, hata)
    fake.sorgular.push(s)
    return s
  }
  return { supabase: { from: (...a) => fake.from(...a) } }
})

import { fetchMutedServers, muteServer, unmuteServer } from '../src/data/mutes.js'

beforeEach(() => {
  fake.sorgular = []
  fake.sonuc = { data: [], error: null }
})

describe('mutes', () => {
  it('fetchMutedServers: server_mutes satırlarından Set', async () => {
    fake.sonuc = { data: [{ server_id: 's1' }, { server_id: 's2' }], error: null }
    const s = await fetchMutedServers()
    expect(s).toBeInstanceOf(Set)
    expect([...s]).toEqual(['s1', 's2'])
    expect(fake.sorgular[0]).toMatchObject({ tablo: 'server_mutes', cagrilar: [['select', 'server_id']] })
  })

  it('muteServer: yalnız server_id eklenir (user_id veritabanında auth.uid())', async () => {
    await muteServer('s1')
    expect(fake.sorgular[0]).toMatchObject({ tablo: 'server_mutes', cagrilar: [['insert', { server_id: 's1' }]] })
  })

  it('muteServer: zaten sessizse (23505) hata yok; başka hatada fırlatır', async () => {
    fake.sonuc = { data: null, error: { code: '23505', message: 'duplicate key' } }
    await expect(muteServer('s1')).resolves.toBeUndefined()
    fake.sonuc = { data: null, error: { code: '42501', message: 'rls' } }
    await expect(muteServer('s1')).rejects.toThrow('rls')
  })

  it('unmuteServer: server_id ile siler', async () => {
    await unmuteServer('s1')
    expect(fake.sorgular[0]).toMatchObject({ tablo: 'server_mutes', cagrilar: [['delete'], ['eq', 'server_id', 's1']] })
  })

  it('fetchMutedServers hatada fırlatır', async () => {
    fake.sonuc = { data: null, error: { message: 'olmadı' } }
    await expect(fetchMutedServers()).rejects.toThrow('olmadı')
  })
})
