// @vitest-environment jsdom
// Çevrimiçi durumu: saf hesaplamalar + izleyici (sahte Supabase kanalı, sahte zamanlayıcı).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => ({}))

vi.mock('../src/lib/supabase.js', () => {
  fake.track = vi.fn()
  fake.untrack = vi.fn()
  fake.removeChannel = vi.fn()
  fake.state = {}
  fake.syncCb = null
  fake.channel = vi.fn(() => {
    const k = {
      on: (_t, _f, cb) => { fake.syncCb = cb; return k },
      subscribe: (cb) => { cb('SUBSCRIBED'); return k },
      track: (...a) => fake.track(...a),
      untrack: (...a) => fake.untrack(...a),
      presenceState: () => fake.state,
    }
    return k
  })
  return { supabase: { channel: (...a) => fake.channel(...a), removeChannel: (...a) => fake.removeChannel(...a) } }
})

import { computeStatus, clampStatusText, mergeEntries, STATUS_COLORS } from '../src/presence/status.js'
import { startPresence, onPresenceChange, isClientOnline, CLIENT_ID, resetPresenceLimiter } from '../src/presence/presence.js'

// Varlık gönderim geçmişi modül düzeyinde (pencereler arası ortak): her test temiz başlasın
beforeEach(() => resetPresenceLimiter())

const DK = 60 * 1000
// Kanal asenkron kurulur (önceki kapanış + oturum anahtarı beklenir): bekleyen işleri bitir
const akit = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

describe('computeStatus', () => {
  it('9 dk işlem yoksa online, 11 dk ise idle', () => {
    expect(computeStatus({ lastActivityMs: 0, nowMs: 9 * DK, manual: null })).toBe('online')
    expect(computeStatus({ lastActivityMs: 0, nowMs: 11 * DK, manual: null })).toBe('idle')
  })
  it('manual dnd her zaman dnd', () => {
    expect(computeStatus({ lastActivityMs: 0, nowMs: 0, manual: 'dnd' })).toBe('dnd')
    expect(computeStatus({ lastActivityMs: 0, nowMs: 99 * DK, manual: 'dnd' })).toBe('dnd')
  })
})

describe('durum yazısı ve renkler', () => {
  it('durum yazısı 60 karakterde kesilir', () => {
    expect(clampStatusText('a'.repeat(100))).toHaveLength(60)
    expect(clampStatusText('kısa')).toBe('kısa')
  })
  it('renkler tam olarak belirtilen değerlerde', () => {
    expect(STATUS_COLORS).toEqual({ online: '#3be37a', idle: '#e0a33b', dnd: '#e05b5b', offline: '#6b7280' })
  })
})

describe('mergeEntries (aynı kişinin birden çok sekmesi)', () => {
  it('dnd > online > idle', () => {
    expect(mergeEntries([{ status: 'idle' }, { status: 'online' }]).status).toBe('online')
    expect(mergeEntries([{ status: 'online' }, { status: 'dnd' }]).status).toBe('dnd')
    expect(mergeEntries([{ status: 'idle' }, { status: 'idle' }]).status).toBe('idle')
    expect(mergeEntries([])).toBe(null)
  })
})

describe('startPresence', () => {
  let prefs
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
    fake.track.mockClear(); fake.untrack.mockClear(); fake.removeChannel.mockClear()
    fake.channel.mockClear()
    prefs = { dnd: false, statusText: '' }
  })
  afterEach(() => vi.useRealTimers())

  it('global presence:voxen (özel) kanalına kullanıcı anahtarıyla katılır ve durumu yayınlar', async () => {
    const p = startPresence('u1', () => prefs)
    await akit()
    expect(fake.channel).toHaveBeenCalledWith('presence:voxen', { config: { private: true, presence: { key: 'u1' } } })
    // Varlık yalnız durum, yazı ve pencere kimliği taşır (sesli durum voice_states tablosunda)
    expect(fake.track).toHaveBeenCalledWith({ status: 'online', statusText: '', clientId: CLIENT_ID })
    p.stop()
  })

  it('10 dk hareketsizlikten sonra idle olur, hareketle hemen online döner; gereksiz track yok', async () => {
    const p = startPresence('u1', () => prefs)
    await akit()
    fake.track.mockClear()
    vi.advanceTimersByTime(5 * DK) // 30 sn'lik hesaplar: değişiklik yok
    expect(fake.track).not.toHaveBeenCalled()
    vi.advanceTimersByTime(6 * DK) // toplam 11 dk
    expect(fake.track).toHaveBeenCalledTimes(1)
    expect(fake.track).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'idle' }))
    window.dispatchEvent(new Event('mousemove'))
    expect(fake.track).toHaveBeenCalledTimes(2)
    expect(fake.track).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'online' }))
    p.stop()
  })

  it('tercihler değişince refresh() hemen yayınlar (dnd + durum yazısı)', async () => {
    const p = startPresence('u1', () => prefs)
    await akit()
    fake.track.mockClear()
    vi.advanceTimersByTime(1000) // bağlandıktan biraz sonra (aynı anda iki gönderim birleştirilir)
    prefs = { dnd: true, statusText: 'çalışıyorum' }
    p.refresh()
    expect(fake.track).toHaveBeenCalledWith({ status: 'dnd', statusText: 'çalışıyorum', clientId: CLIENT_ID })
    p.refresh() // aynı değerler: tekrar yayınlama
    expect(fake.track).toHaveBeenCalledTimes(1)
    p.stop()
  })

  it('stop(): untrack, kanalı kaldırır, dinleyicileri ve sayacı bırakır', async () => {
    const p = startPresence('u1', () => prefs)
    await akit()
    await p.stop()
    expect(fake.untrack).toHaveBeenCalled()
    expect(fake.removeChannel).toHaveBeenCalled()
    fake.track.mockClear()
    vi.advanceTimersByTime(15 * DK)
    window.dispatchEvent(new Event('mousemove'))
    expect(fake.track).not.toHaveBeenCalled()
  })

  it('sync olayı haritayı dinleyicilere verir; anahtarı olmayan çevrimdışıdır', async () => {
    const p = startPresence('u1', () => prefs)
    await akit()
    const alinan = vi.fn()
    const birak = onPresenceChange(alinan)
    fake.state = { u2: [{ status: 'idle', statusText: 'x', voiceChannelId: null }] }
    fake.syncCb()
    const harita = alinan.mock.calls.at(-1)[0]
    expect(harita.get('u2').status).toBe('idle')
    expect(harita.has('u3')).toBe(false)
    birak()
    p.stop()
  })
})

describe('aynı hesabın başka penceresi', () => {
  it('isClientOnline: o pencere (clientId) varlıkta görünüyor mu', async () => {
    const p = startPresence('u1', () => ({ dnd: false, statusText: '' }))
    await akit()
    fake.state = { u1: [{ status: 'online', clientId: CLIENT_ID }, { status: 'online', clientId: 'baska' }] }
    fake.syncCb()
    expect(isClientOnline('u1', 'baska')).toBe(true)
    expect(isClientOnline('u1', 'kapanmis')).toBe(false)
    expect(isClientOnline('u2', 'baska')).toBe(false)
    expect(fake.track).toHaveBeenCalledWith(expect.objectContaining({ clientId: CLIENT_ID }))
    p.stop()
  })
})

describe('konuşma etkinlik sayılır', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
    fake.track.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('isActive() true iken (konuşma kapısı açık) 11 dk sonra da boşta olmaz', async () => {
    let acik = true
    const p = startPresence('u1', () => ({ dnd: false, statusText: '' }), { isActive: () => acik })
    await akit()
    fake.track.mockClear()
    vi.advanceTimersByTime(11 * DK)
    expect(fake.track).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'idle' }))
    acik = false
    vi.advanceTimersByTime(11 * DK)
    expect(fake.track).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'idle' }))
    p.stop()
  })

  it('activity(): boştayken çağrılınca hemen çevrimiçi olur', async () => {
    const p = startPresence('u1', () => ({ dnd: false, statusText: '' }))
    await akit()
    vi.advanceTimersByTime(11 * DK)
    expect(fake.track).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'idle' }))
    p.activity()
    expect(fake.track).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'online' }))
    p.stop()
  })
})
