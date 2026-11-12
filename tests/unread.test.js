// @vitest-environment jsdom
// Okunmamış sayacı: durum izleyicisi (unread.js) ve şerit/kanal satırı çizimleri.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/data/reads.js', () => {
  fake.fetch = vi.fn()
  fake.markRead = vi.fn()
  fake.handlers = null
  fake.closed = false
  return {
    fetchUnreadCounts: (...a) => fake.fetch(...a),
    markRead: (...a) => fake.markRead(...a),
    subscribeAllMessages: (h) => { fake.handlers = h; return () => { fake.closed = true } },
  }
})

import { createUnreadTracker, sayiYazisi, baslikYazisi, unreadTiming } from '../src/ui/unread.js'
import { renderRail } from '../src/ui/serverRail.js'
import { renderChannelList } from '../src/ui/channelList.js'

const sayilar = (o) => new Map(Object.entries(o).map(([k, [serverId, count]]) => [k, { serverId, count }]))
const bos = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

let reading, focused, degisim, tracker
async function kur() {
  tracker = createUnreadTracker({ profileId: 'me', getReading: () => reading, isFocused: () => focused, onChange: degisim })
  await bos()
}

beforeEach(() => {
  vi.useFakeTimers()
  reading = null
  focused = true
  degisim = vi.fn()
  fake.fetch.mockReset()
  fake.markRead.mockReset()
  fake.closed = false
  fake.fetch.mockResolvedValue(sayilar({ a: ['s1', 2], b: ['s1', 0], c: ['s2', 5] }))
})
afterEach(() => { tracker?.destroy(); vi.useRealTimers() })

describe('yazılar', () => {
  it('99+ ve başlık', () => {
    expect(sayiYazisi(0)).toBe('')
    expect(sayiYazisi(7)).toBe('7')
    expect(sayiYazisi(99)).toBe('99')
    expect(sayiYazisi(100)).toBe('99+')
    expect(baslikYazisi(0)).toBe('Voxen')
    expect(baslikYazisi(3)).toBe('(3) Voxen')
    expect(baslikYazisi(150)).toBe('(99+) Voxen')
  })
})

describe('createUnreadTracker', () => {
  it('açılışta sayıları alır; kanal, sunucu ve toplam sayıları verir', async () => {
    await kur()
    expect(tracker.count('a')).toBe(2)
    expect(tracker.count('b')).toBe(0)
    expect(tracker.count('yok')).toBe(0)
    expect(tracker.serverCount('s1')).toBe(2)
    expect(tracker.total()).toBe(7)
    expect(degisim).toHaveBeenCalled()
  })

  it('başkasının mesajı sayıyı artırır; kendi mesajım ve silinmişler artırmaz', async () => {
    await kur()
    fake.handlers.onInsert({ id: 10, channel_id: 'b', author_id: 'baskasi' })
    expect(tracker.count('b')).toBe(1)
    fake.handlers.onInsert({ id: 11, channel_id: 'b', author_id: 'me' })
    fake.handlers.onInsert({ id: 12, channel_id: 'b', author_id: 'baskasi', deleted_at: 'x' })
    expect(tracker.count('b')).toBe(1)
    expect(tracker.total()).toBe(8)
  })

  it('açık kanal odakta ve en alttaysa artmaz, okundu işaretlenir; yukarıdaysa ya da odak yoksa artar', async () => {
    await kur()
    reading = { channelId: 'a', atBottom: true }
    fake.handlers.onInsert({ id: 20, channel_id: 'a', author_id: 'x' })
    expect(tracker.count('a')).toBe(2)
    expect(fake.markRead).toHaveBeenCalledWith('a', 20)
    reading = { channelId: 'a', atBottom: false }
    fake.handlers.onInsert({ id: 21, channel_id: 'a', author_id: 'x' })
    expect(tracker.count('a')).toBe(3)
    reading = { channelId: 'a', atBottom: true }
    focused = false
    fake.handlers.onInsert({ id: 22, channel_id: 'a', author_id: 'x' })
    expect(tracker.count('a')).toBe(4)
  })

  it('markChannelRead sayıyı sıfırlar ve işareti yazar', async () => {
    await kur()
    tracker.markChannelRead('a', 33)
    expect(tracker.count('a')).toBe(0)
    expect(fake.markRead).toHaveBeenCalledWith('a', 33)
  })

  it('silme 2 sn içinde tek sorguda birleşir; yeniden bağlanınca hemen alınır', async () => {
    await kur()
    fake.fetch.mockClear()
    fake.handlers.onUpdate({ id: 1, channel_id: 'a', author_id: 'x', deleted_at: 't' })
    fake.handlers.onUpdate({ id: 2, channel_id: 'a', author_id: 'x', deleted_at: 't' })
    fake.handlers.onUpdate({ id: 3, channel_id: 'a', author_id: 'x', content: 'düzenlendi' }) // düzenleme sorgu açmaz
    expect(fake.fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(unreadTiming.refetchMs)
    expect(fake.fetch).toHaveBeenCalledTimes(1)
    fake.handlers.onReconnect()
    await bos()
    expect(fake.fetch).toHaveBeenCalledTimes(2)
  })

  it('bilinmeyen kanaldan mesaj gelince (yeni kanal) sayılar yeniden alınır', async () => {
    await kur()
    fake.fetch.mockClear()
    fake.fetch.mockResolvedValue(sayilar({ a: ['s1', 2], n: ['s1', 1] }))
    fake.handlers.onInsert({ id: 5, channel_id: 'n', author_id: 'x' })
    await vi.advanceTimersByTimeAsync(unreadTiming.refetchMs)
    expect(tracker.count('n')).toBe(1)
  })

  it('yeniden alma açık ve okunan kanalın eski sayısını göstermez', async () => {
    await kur()
    reading = { channelId: 'a', atBottom: true }
    fake.handlers.onReconnect()
    await bos()
    expect(tracker.count('a')).toBe(0)
    expect(tracker.count('c')).toBe(5)
  })

  it('ağ hatasında eski sayılar kalır; prune ayrılınan sunucuyu düşürür; destroy aboneliği kapatır', async () => {
    await kur()
    fake.fetch.mockRejectedValue(new Error('ağ'))
    fake.handlers.onReconnect()
    await bos()
    expect(tracker.total()).toBe(7)
    tracker.prune(new Set(['s1']))
    expect(tracker.total()).toBe(2)
    tracker.destroy()
    expect(fake.closed).toBe(true)
  })
})

describe('çizimler', () => {
  it('sunucu şeridi: okunmamışı olan sunucuda nokta ve rozet (99+); olmayanda yok', () => {
    document.body.innerHTML = '<div id="r"></div>'
    const rail = document.querySelector('#r')
    const okunmamis = { serverCount: (id) => ({ s1: 120, s2: 0 })[id] ?? 0 }
    renderRail(rail, [{ id: 's1', name: 'Bir' }, { id: 's2', name: 'İki' }], 's2', {}, okunmamis)
    const [i1, i2] = rail.querySelectorAll('.server-icon:not(.add):not(.join)')
    expect(i1.querySelector('.server-unread-dot')).not.toBeNull()
    expect(i1.querySelector('.unread-badge').textContent).toBe('99+')
    expect(i2.querySelector('.unread-badge')).toBeNull()
  })

  it('kanal listesi: yazılı kanalda .unread ve .unread-count; sesli kanalda hiç yok', () => {
    document.body.innerHTML = '<div id="p"></div>'
    const panel = document.querySelector('#p')
    renderChannelList(panel, {
      server: { id: 's1', name: 'S', owner_id: 'x' },
      channels: [
        { id: 'a', name: 'genel', kind: 'text' },
        { id: 'b', name: 'sohbet', kind: 'text' },
        { id: 'v', name: 'Lobi', kind: 'voice' },
      ],
      profile: { id: 'me', username: 'ben', color: '#fff' },
      selectedChannelId: 'b',
      unread: { count: (id) => ({ a: 150, v: 9 })[id] ?? 0 },
      handlers: {},
    })
    const satirlar = [...panel.querySelectorAll('.channel-item')]
    const a = satirlar.find((s) => s.textContent.includes('genel'))
    expect(a.classList.contains('unread')).toBe(true)
    expect(a.querySelector('.unread-count').textContent).toBe('99+')
    expect(satirlar.find((s) => s.textContent.includes('sohbet')).classList.contains('unread')).toBe(false)
    const v = satirlar.find((s) => s.textContent.includes('Lobi'))
    expect(v.classList.contains('unread')).toBe(false)
    expect(v.querySelector('.unread-count')).toBeNull()
  })
})
