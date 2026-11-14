// Bildirim ayarları verisi (src/data/notifyPrefs.js): 015 tabloları, mark_server_read, sessiz DM'ler.
import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/lib/supabase.js', () => {
  fake.sorgular = []
  fake.sonuclar = {} // tablo -> { data, error }
  fake.from = (tablo) => {
    const s = { tablo, cagrilar: [] }
    for (const ad of ['select', 'insert', 'upsert', 'delete', 'eq']) {
      s[ad] = (...a) => { s.cagrilar.push([ad, ...a]); return s }
    }
    s.then = (ok, hata) => Promise.resolve(fake.sonuclar[tablo] ?? { data: [], error: null }).then(ok, hata)
    fake.sorgular.push(s)
    return s
  }
  fake.rpc = vi.fn(async () => fake.rpcSonuc ?? { data: 3, error: null })
  return { supabase: { from: (...a) => fake.from(...a), rpc: (...a) => fake.rpc(...a) } }
})

import {
  fetchNotifyPrefs, setServerNotifyLevel, setChannelNotifyPrefs, markServerRead, fetchMutedDms,
} from '../src/data/notifyPrefs.js'

beforeEach(() => {
  fake.sorgular = []
  fake.sonuclar = {}
  fake.rpcSonuc = null
  fake.rpc.mockClear()
})

describe('notifyPrefs', () => {
  it('fetchNotifyPrefs: iki tablodan Map\'ler', async () => {
    fake.sonuclar.server_notify_levels = { data: [{ server_id: 's1', level: 'all' }], error: null }
    fake.sonuclar.channel_notify_prefs = { data: [{ channel_id: 'c1', level: null, muted: true, muted_until: '2026-11-14T13:00:00Z' }], error: null }
    const p = await fetchNotifyPrefs()
    expect(p.sunucular.get('s1')).toBe('all')
    expect(p.kanallar.get('c1')).toEqual({ level: null, muted: true, mutedUntil: '2026-11-14T13:00:00Z' })
  })

  it('fetchNotifyPrefs hatada fırlatır', async () => {
    fake.sonuclar.channel_notify_prefs = { data: null, error: { message: 'olmadı' } }
    await expect(fetchNotifyPrefs()).rejects.toThrow('olmadı')
  })

  it('setServerNotifyLevel: varsayılan (mentions) satırı siler, diğerleri upsert', async () => {
    await setServerNotifyLevel('s1', 'all')
    expect(fake.sorgular[0]).toMatchObject({ tablo: 'server_notify_levels', cagrilar: [['upsert', { server_id: 's1', level: 'all' }, { onConflict: 'user_id,server_id' }]] })
    await setServerNotifyLevel('s1', 'mentions')
    expect(fake.sorgular[1]).toMatchObject({ tablo: 'server_notify_levels', cagrilar: [['delete'], ['eq', 'server_id', 's1']] })
  })

  it('setServerNotifyLevel: geçersiz düzey reddedilir', async () => {
    await expect(setServerNotifyLevel('s1', 'hepsi')).rejects.toThrow()
    expect(fake.sorgular).toHaveLength(0)
  })

  it('setChannelNotifyPrefs: varsayılan + sessiz değil -> satır silinir; aksi upsert', async () => {
    await setChannelNotifyPrefs('c1', { level: 'none', muted: true, mutedUntil: null })
    expect(fake.sorgular[0]).toMatchObject({
      tablo: 'channel_notify_prefs',
      cagrilar: [['upsert', { channel_id: 'c1', level: 'none', muted: true, muted_until: null }, { onConflict: 'user_id,channel_id' }]],
    })
    await setChannelNotifyPrefs('c1', { level: null, muted: false, mutedUntil: '2026-11-14T13:00:00Z' })
    expect(fake.sorgular[1]).toMatchObject({ tablo: 'channel_notify_prefs', cagrilar: [['delete'], ['eq', 'channel_id', 'c1']] })
  })

  it('setChannelNotifyPrefs: sessiz değilse süre yazılmaz', async () => {
    await setChannelNotifyPrefs('c1', { level: 'all', muted: false, mutedUntil: '2026-11-14T13:00:00Z' })
    expect(fake.sorgular[0].cagrilar[0][1]).toEqual({ channel_id: 'c1', level: 'all', muted: false, muted_until: null })
  })

  it('markServerRead: RPC; hata Türkçe metinle fırlar', async () => {
    await markServerRead('s1')
    expect(fake.rpc).toHaveBeenCalledWith('mark_server_read', { sid: 's1' })
    fake.rpcSonuc = { data: null, error: { message: 'NOT_ALLOWED' } }
    await expect(markServerRead('s1')).rejects.toThrow('Bu sunucuda bunu yapamazsın.')
  })

  it('fetchMutedDms: dm_mutes satırlarından Set', async () => {
    fake.sonuclar.dm_mutes = { data: [{ thread_id: 't1' }], error: null }
    const s = await fetchMutedDms()
    expect([...s]).toEqual(['t1'])
    expect(fake.sorgular[0]).toMatchObject({ tablo: 'dm_mutes', cagrilar: [['select', 'thread_id']] })
  })
})
