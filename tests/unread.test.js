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

describe('@bahsetme sayısı', () => {
  const anmali = (o) => new Map(Object.entries(o).map(([k, [serverId, count, mentions]]) => [k, { serverId, count, mentions }]))
  let ad
  async function kurAdli() {
    tracker = createUnreadTracker({ profileId: 'me', getUsername: () => ad, getReading: () => reading, isFocused: () => focused, onChange: degisim })
    await bos()
  }
  beforeEach(() => {
    ad = 'berk'
    fake.fetch.mockResolvedValue(anmali({ a: ['s1', 3, 1], b: ['s1', 0, 0], c: ['s2', 5, 2] }))
  })

  it('açılışta unread_counts().mentions kullanılır; kanal ve sunucu toplamı', async () => {
    await kurAdli()
    expect(tracker.mentions('a')).toBe(1)
    expect(tracker.mentions('yok')).toBe(0)
    expect(tracker.serverMentions('s1')).toBe(1)
    expect(tracker.serverMentions('s2')).toBe(2)
  })

  it('beni anan yeni mesaj sayıyı artırır; anmayan, kendi mesajım ve okunan kanal artırmaz', async () => {
    await kurAdli()
    fake.handlers.onInsert({ id: 1, channel_id: 'b', author_id: 'x', content: 'selam @Berk.' })
    expect(tracker.mentions('b')).toBe(1)
    expect(tracker.count('b')).toBe(1)
    fake.handlers.onInsert({ id: 2, channel_id: 'b', author_id: 'x', content: '@berkcan x@berk' })
    expect(tracker.mentions('b')).toBe(1)
    expect(tracker.count('b')).toBe(2)
    fake.handlers.onInsert({ id: 3, channel_id: 'b', author_id: 'me', content: '@berk' })
    expect(tracker.mentions('b')).toBe(1)
    reading = { channelId: 'b', atBottom: true }
    fake.handlers.onInsert({ id: 4, channel_id: 'b', author_id: 'x', content: '@berk' })
    expect(tracker.mentions('b')).toBe(1)
  })

  it('ad değişince yeni adla taranır', async () => {
    await kurAdli()
    ad = 'yeniAd'
    fake.handlers.onInsert({ id: 1, channel_id: 'b', author_id: 'x', content: '@berk @yeniad' })
    expect(tracker.mentions('b')).toBe(1)
  })

  it('okundu işaretlenince sıfırlanır', async () => {
    await kurAdli()
    degisim.mockClear()
    tracker.markChannelRead('a', 5)
    expect(tracker.mentions('a')).toBe(0)
    expect(tracker.serverMentions('s1')).toBe(0)
    expect(degisim).toHaveBeenCalled()
  })

  it('@herkes içeren mesaj (beni anmıyorsa) sayıları sunucudan yeniden aldırır (izin veritabanında)', async () => {
    await kurAdli()
    fake.fetch.mockClear()
    fake.fetch.mockResolvedValue(anmali({ a: ['s1', 3, 1], b: ['s1', 1, 1], c: ['s2', 5, 2] }))
    fake.handlers.onInsert({ id: 1, channel_id: 'b', author_id: 'x', content: 'toplantı @herkes' })
    expect(tracker.mentions('b')).toBe(0) // yerelde sayılmaz
    await vi.advanceTimersByTimeAsync(unreadTiming.refetchMs)
    expect(fake.fetch).toHaveBeenCalledTimes(1)
    expect(tracker.mentions('b')).toBe(1)
    fake.fetch.mockClear()
    fake.handlers.onInsert({ id: 2, channel_id: 'b', author_id: 'x', content: '@berk @herkes' }) // zaten sayıldı
    fake.handlers.onInsert({ id: 3, channel_id: 'b', author_id: 'x', content: 'herkes geldi' })
    await vi.advanceTimersByTimeAsync(unreadTiming.refetchMs)
    expect(fake.fetch).not.toHaveBeenCalled()
  })

  it('getUsername verilmezse ya da içerik yoksa sayı artmaz (eski çağrılar bozulmaz)', async () => {
    await kur()
    fake.handlers.onInsert({ id: 1, channel_id: 'b', author_id: 'x', content: '@berk' })
    fake.handlers.onInsert({ id: 2, channel_id: 'b', author_id: 'x' })
    expect(tracker.mentions('b')).toBe(0)
    expect(tracker.count('b')).toBe(2)
  })

  it('şerit ve kanal satırında "@" işareti yalnız bahsetme varsa; aria-label bahsetmeyi söyler', () => {
    document.body.innerHTML = '<div id="r"></div><div id="p"></div>'
    const rail = document.querySelector('#r')
    const sayac = {
      serverCount: (id) => ({ s1: 4, s2: 2 })[id] ?? 0,
      serverMentions: (id) => ({ s1: 1 })[id] ?? 0,
      count: (id) => ({ a: 4, b: 2 })[id] ?? 0,
      mentions: (id) => ({ a: 1 })[id] ?? 0,
    }
    renderRail(rail, [{ id: 's1', name: 'Bir' }, { id: 's2', name: 'İki' }], null, {}, sayac)
    const [i1, i2] = rail.querySelectorAll('.server-icon:not(.add):not(.join)')
    expect(i1.querySelector('.unread-badge .mention-mark').textContent).toBe('@')
    expect(i1.querySelector('.unread-badge').textContent).toBe('@4')
    expect(i1.getAttribute('aria-label')).toBe('Bir, 4 okunmamış mesaj, 1 bahsetme')
    expect(i2.querySelector('.mention-mark')).toBeNull()

    const panel = document.querySelector('#p')
    renderChannelList(panel, {
      server: { id: 's1', name: 'S', owner_id: 'x' },
      channels: [{ id: 'a', name: 'genel', kind: 'text' }, { id: 'b', name: 'sohbet', kind: 'text' }],
      profile: { id: 'me', username: 'ben', color: '#fff' },
      selectedChannelId: null,
      unread: sayac,
      handlers: {},
    })
    const satirlar = [...panel.querySelectorAll('.channel-item')]
    const a = satirlar.find((s) => s.textContent.includes('genel'))
    expect(a.querySelector('.unread-count .mention-mark').textContent).toBe('@')
    expect(a.getAttribute('aria-label')).toBe('genel, 4 okunmamış mesaj, 1 bahsetme')
    expect(satirlar.find((s) => s.textContent.includes('sohbet')).querySelector('.mention-mark')).toBeNull()
  })
})

describe('sessiz kanal ve rozet toplamı (v0.13.0)', () => {
  it('sessiz kanal sunucu sayısına ve toplama katılmaz; bahsetmesi katılır; mentionTotal sessiz sunucuyu atlar', async () => {
    fake.fetch.mockResolvedValue(new Map([
      ['a', { serverId: 's1', count: 3, mentions: 1 }],
      ['b', { serverId: 's1', count: 2, mentions: 0 }],
      ['c', { serverId: 's2', count: 4, mentions: 2 }],
    ]))
    const sessiz = new Set(['a'])
    tracker = createUnreadTracker({ profileId: 'me', getReading: () => null, isFocused: () => true, onChange: degisim, isMuted: (id) => sessiz.has(id) })
    await bos()
    expect(tracker.count('a')).toBe(3) // ham sayı (kanal satırı sessizliği kendisi bilir)
    expect(tracker.serverCount('s1')).toBe(2)
    expect(tracker.serverMentions('s1')).toBe(1)
    expect(tracker.total()).toBe(6)
    expect(tracker.mentionTotal()).toBe(3)
    expect(tracker.mentionTotal(new Set(['s2']))).toBe(1)
  })

  it('markServerRead: sunucunun bütün kanalları yerelde sıfırlanır', async () => {
    await kur()
    degisim.mockClear()
    tracker.markServerRead('s1')
    expect(tracker.serverCount('s1')).toBe(0)
    expect(tracker.count('c')).toBe(5)
    expect(degisim).toHaveBeenCalled()
  })

  it('kanal listesi: sessiz kanal soluk, kalın/sayı yok; beni anan varsa yalnız @ rozeti', () => {
    document.body.innerHTML = '<div id="p"></div>'
    const panel = document.querySelector('#p')
    const sayac = { count: (id) => ({ a: 4, b: 2 })[id] ?? 0, mentions: (id) => ({ a: 1 })[id] ?? 0 }
    renderChannelList(panel, {
      server: { id: 's1', name: 'S', owner_id: 'x' },
      channels: [{ id: 'a', name: 'genel', kind: 'text' }, { id: 'b', name: 'sohbet', kind: 'text' }],
      profile: { id: 'me', username: 'ben', color: '#fff' },
      selectedChannelId: null,
      unread: sayac,
      channelMuted: () => true,
      handlers: {},
    })
    const satirlar = [...panel.querySelectorAll('.channel-item')]
    const a = satirlar.find((s) => s.textContent.includes('genel'))
    const b = satirlar.find((s) => s.textContent.includes('sohbet'))
    expect(a.classList.contains('channel-muted')).toBe(true)
    expect(a.classList.contains('unread')).toBe(false)
    expect(a.querySelector('.unread-count').textContent).toBe('@1')
    expect(a.getAttribute('aria-label')).toBe('genel, sessizde, 1 bahsetme')
    expect(b.classList.contains('unread')).toBe(false)
    expect(b.querySelector('.unread-count')).toBeNull()
    expect(b.getAttribute('aria-label')).toBe('sohbet, sessizde')
  })

  it('kanala sağ tık: onChannelNotify(kanal, satır) çağrılır, tarayıcı menüsü açılmaz', () => {
    document.body.innerHTML = '<div id="p"></div>'
    const panel = document.querySelector('#p')
    const onChannelNotify = vi.fn()
    renderChannelList(panel, {
      server: { id: 's1', name: 'S', owner_id: 'x' },
      channels: [{ id: 'a', name: 'genel', kind: 'text' }, { id: 'v', name: 'ses', kind: 'voice' }],
      profile: { id: 'me', username: 'ben', color: '#fff' },
      selectedChannelId: null,
      handlers: { onChannelNotify },
    })
    const [a, v] = panel.querySelectorAll('.channel-item')
    const olay = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    a.dispatchEvent(olay)
    expect(olay.defaultPrevented).toBe(true)
    expect(onChannelNotify).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), a)
    v.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(onChannelNotify).toHaveBeenCalledTimes(1) // sesli kanalda bildirim yok
  })

  it('şerit: yalnız bahsetme varsa (sessiz kanaldan) @ rozeti çıkar', () => {
    document.body.innerHTML = '<div id="r"></div>'
    const rail = document.querySelector('#r')
    renderRail(rail, [{ id: 's1', name: 'Bir' }], null, {}, { serverCount: () => 0, serverMentions: () => 2 })
    const i1 = rail.querySelector('.server-icon')
    expect(i1.querySelector('.unread-badge').textContent).toBe('@2')
    expect(i1.getAttribute('aria-label')).toBe('Bir, 2 bahsetme')
  })
})
