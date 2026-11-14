// Bildirim düzeyi kuralları (src/bildirimDuzeyi.js): etkin düzey, süreli sessizlik, kanal bildirim kararı.
import { describe, it, expect } from 'vitest'
import {
  VARSAYILAN_DUZEY, etkinDuzey, kanalSessizMi, kanalBildirimKarari, sessizBitisi, enYakinBitis, SESSIZ_SURELERI,
} from '../src/bildirimDuzeyi.js'

const SIMDI = Date.parse('2026-11-14T12:00:00Z')

describe('etkinDuzey', () => {
  it('kanal düzeyi > sunucu düzeyi > varsayılan (yalnız bahsetmeler)', () => {
    expect(VARSAYILAN_DUZEY).toBe('mentions')
    expect(etkinDuzey(undefined, undefined)).toBe('mentions')
    expect(etkinDuzey('all', null)).toBe('all')
    expect(etkinDuzey('all', { level: null, muted: true })).toBe('all') // kanal: sunucu varsayılanı
    expect(etkinDuzey('all', { level: 'none' })).toBe('none')
    expect(etkinDuzey(null, { level: 'all' })).toBe('all')
  })
})

describe('kanalSessizMi', () => {
  it('sessiz değil / süresiz sessiz / süresi dolmamış / dolmuş', () => {
    expect(kanalSessizMi(null, SIMDI)).toBe(false)
    expect(kanalSessizMi({ muted: false }, SIMDI)).toBe(false)
    expect(kanalSessizMi({ muted: true, mutedUntil: null }, SIMDI)).toBe(true)
    expect(kanalSessizMi({ muted: true, mutedUntil: '2026-11-14T13:00:00Z' }, SIMDI)).toBe(true)
    expect(kanalSessizMi({ muted: true, mutedUntil: '2026-11-14T11:59:59Z' }, SIMDI)).toBe(false)
  })
  it('bozuk tarih: sessiz sayılmaz', () => {
    expect(kanalSessizMi({ muted: true, mutedUntil: 'bozuk' }, SIMDI)).toBe(false)
  })
})

describe('kanalBildirimKarari', () => {
  const k = (o) => kanalBildirimKarari({ duzey: 'mentions', kanalSessiz: false, sunucuSessiz: false, anar: false, herkes: false, ...o })
  it('sunucu sessizde: hiçbir şey (anma dahil)', () => {
    expect(k({ sunucuSessiz: true, anar: true, duzey: 'all' })).toBe(null)
  })
  it('kanal sessizde: yalnız beni doğrudan anan mesaj', () => {
    expect(k({ kanalSessiz: true, duzey: 'all' })).toBe(null)
    expect(k({ kanalSessiz: true, herkes: true })).toBe(null)
    expect(k({ kanalSessiz: true, anar: true, duzey: 'none' })).toBe('mention')
  })
  it('Hiçbiri: bildirim yok', () => {
    expect(k({ duzey: 'none', anar: true })).toBe(null)
  })
  it('Yalnız bahsetmeler: anma -> mention, @herkes -> everyone (izin denetlenecek), düz mesaj -> yok', () => {
    expect(k({ anar: true })).toBe('mention')
    expect(k({ herkes: true })).toBe('everyone')
    expect(k({})).toBe(null)
  })
  it('Tüm mesajlar: her mesaj; anan mesaj yine mention', () => {
    expect(k({ duzey: 'all' })).toBe('all')
    expect(k({ duzey: 'all', herkes: true })).toBe('all')
    expect(k({ duzey: 'all', anar: true })).toBe('mention')
  })
})

describe('sessizBitisi / enYakinBitis', () => {
  it('süreler: 1, 8, 24 saat ve ben açana kadar', () => {
    expect(SESSIZ_SURELERI.map((s) => s.saat)).toEqual([1, 8, 24, null])
    expect(sessizBitisi(1, SIMDI)).toBe('2026-11-14T13:00:00.000Z')
    expect(sessizBitisi(24, SIMDI)).toBe('2026-11-15T12:00:00.000Z')
    expect(sessizBitisi(null, SIMDI)).toBe(null)
  })
  it('enYakinBitis: gelecekteki en yakın süre bitişi (ms); yoksa null', () => {
    const prefs = new Map([
      ['a', { muted: true, mutedUntil: '2026-11-14T15:00:00Z' }],
      ['b', { muted: true, mutedUntil: '2026-11-14T13:00:00Z' }],
      ['c', { muted: true, mutedUntil: null }],
      ['d', { muted: true, mutedUntil: '2026-11-14T10:00:00Z' }], // geçmiş
      ['e', { muted: false }],
    ])
    expect(enYakinBitis(prefs, SIMDI)).toBe(Date.parse('2026-11-14T13:00:00Z'))
    expect(enYakinBitis(new Map(), SIMDI)).toBe(null)
  })
})
