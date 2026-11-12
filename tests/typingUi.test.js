// @vitest-environment jsdom
// "yazıyor…" göstergesi arayüz testleri: gerçek typing.js, sahte Supabase, sahte saat.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => ({}))

vi.mock('../src/lib/supabase.js', () => {
  fake.rows = []
  fake.sent = [] // yayınlar: { event, payload }
  fake.bc = {} // event -> geri çağrı
  fake.topics = []
  fake.insertCb = null
  fake.rpc = vi.fn(async () => ({ data: null, error: null }))
  const zincir = () => {
    const z = {
      insert: () => z, single: async () => ({ data: { id: 50, channel_id: 'c1', author_id: 'u1', content: 'merhaba', edited_at: null, deleted_at: null, created_at: new Date().toISOString() }, error: null }),
      select: () => z, eq: () => z, lt: () => z, gt: () => z, in: () => z, is: () => z, order: () => z, limit: () => z,
      then: (res) => res({ data: fake.rows, error: null }),
    }
    return z
  }
  fake.channel = vi.fn((konu) => {
    fake.topics.push(konu)
    const k = {
      on: (tur, f, cb) => {
        if (tur === 'broadcast') fake.bc[f.event] = cb
        else if (f.event === 'INSERT') fake.insertCb = cb
        return k
      },
      subscribe: (cb) => { setTimeout(() => cb('SUBSCRIBED'), 0); return k },
      send: (m) => { fake.sent.push({ event: m.event, payload: m.payload }); return Promise.resolve('ok') },
    }
    return k
  })
  return {
    supabase: {
      from: () => zincir(),
      rpc: (...a) => fake.rpc(...a),
      channel: (...a) => fake.channel(...a),
      removeChannel: vi.fn(async () => {}),
      realtime: { setAuth: async () => {} },
    },
  }
})

import { mountChat } from '../src/ui/chatView.js'

const ben = { id: 'u1', username: 'berk', color: '#5b7cfa', avatar_url: null }
const ms = (id, author, content = 'x', edited = null) => ({
  id, channel_id: 'c1', author_id: author, content, edited_at: edited, deleted_at: null,
  created_at: new Date(Date.UTC(2026, 10, 12, 10, 0) + id * 60000).toISOString(),
})
const ilerle = (ms_) => vi.advanceTimersByTimeAsync(ms_)
const satir = () => document.querySelector('.typing-line')
const yaz = (ad, id = ad) => fake.bc.yaziyor({ payload: { user_id: id, username: ad } })
const kutuYaz = (kutu, deger) => { kutu.value = deger; kutu.dispatchEvent(new Event('input', { bubbles: true })) }

let sohbet
beforeEach(async () => {
  vi.useFakeTimers()
  document.body.innerHTML = '<div id="main"></div>'
  fake.rows = []
  fake.sent = []
  fake.topics = []
  sohbet = mountChat(document.getElementById('main'), { channel: { id: 'c1', name: 'genel' }, profile: ben })
  await ilerle(10)
})
afterEach(() => { sohbet?.destroy(); vi.useRealTimers() })

describe('yazıyor satırı', () => {
  it('private typing konusuna katılır; satır sabit yükseklikli, aria-live yok', () => {
    expect(fake.topics).toContain('typing:c1')
    expect(satir()).not.toBeNull()
    expect(satir().hasAttribute('aria-live')).toBe(false)
    expect(satir().closest('[aria-live]')).toBeNull()
    expect(satir().textContent).toBe('')
  })

  it('1, 2, 3 kişi ve 4+ kişi metinleri; adlar kalın (strong) ve textContent ile', () => {
    yaz('Ayla')
    expect(satir().textContent).toBe('Ayla yazıyor…')
    expect([...satir().querySelectorAll('strong')].map((e) => e.textContent)).toEqual(['Ayla'])
    yaz('Kerem')
    expect(satir().textContent).toBe('Ayla ve Kerem yazıyor…')
    yaz('Deniz')
    expect(satir().textContent).toBe('Ayla, Kerem ve Deniz yazıyor…')
    expect(satir().querySelectorAll('strong').length).toBe(3)
    yaz('Mert')
    expect(satir().textContent).toBe('Birkaç kişi yazıyor…')
    expect(satir().querySelectorAll('strong').length).toBe(0)
  })

  it('ad HTML olarak çalışmaz', () => {
    yaz('<img src=x onerror=alert(1)>', 'z')
    expect(satir().querySelector('img')).toBeNull()
    expect(satir().querySelector('strong').textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('5 sn sinyal gelmezse gösterge kalkar', async () => {
    yaz('Ayla')
    await ilerle(4900)
    expect(satir().textContent).toBe('Ayla yazıyor…')
    await ilerle(200)
    expect(satir().textContent).toBe('')
  })

  it('o kişinin mesajı gelince adı hemen düşer', async () => {
    fake.rows = []
    yaz('Ayla', 'u2')
    yaz('Kerem', 'u3')
    fake.insertCb({ new: ms(1, 'u2', 'selam') })
    await ilerle(10)
    expect(satir().textContent).toBe('Kerem yazıyor…')
  })

  it('kendi sinyalimiz gösterilmez', () => {
    yaz('berk', 'u1')
    expect(satir().textContent).toBe('')
  })
})

describe('yazarken gönderim', () => {
  it('3 sn içinde tek yaziyor; boşalınca birakti', async () => {
    const kutu = document.querySelector('.composer textarea')
    kutuYaz(kutu, 'a')
    kutuYaz(kutu, 'ab')
    expect(fake.sent.map((s) => s.event)).toEqual(['yaziyor'])
    expect(fake.sent[0].payload).toEqual({ user_id: 'u1', username: 'berk' })
    await ilerle(3100)
    kutuYaz(kutu, 'abc')
    expect(fake.sent.map((s) => s.event)).toEqual(['yaziyor', 'yaziyor'])
    kutuYaz(kutu, '')
    expect(fake.sent.at(-1).event).toBe('birakti')
  })

  it('mesaj gönderilince birakti gider', async () => {
    const kutu = document.querySelector('.composer textarea')
    kutuYaz(kutu, 'merhaba')
    kutu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await ilerle(10)
    expect(fake.sent.map((s) => s.event)).toEqual(['yaziyor', 'birakti'])
  })

  it('kanal değişince (destroy) birakti gider ve zamanlayıcı kalmaz', async () => {
    const kutu = document.querySelector('.composer textarea')
    kutuYaz(kutu, 'a')
    yaz('Ayla')
    sohbet.destroy()
    sohbet = null
    expect(fake.sent.at(-1).event).toBe('birakti')
    await ilerle(10)
    expect(vi.getTimerCount()).toBe(0)
  })
})
