// @vitest-environment jsdom
// Uygulama + sohbet bağlantısı: kanal/sunucu değişiminde abonelik ve yarış durumları.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))

vi.mock('../src/lib/supabase.js', () => {
  fake.rows = {}
  fake.subs = 0 // açık abonelik sayısı
  fake.channelsGate = null // listChannels'ı bekletmek için
  fake.from = vi.fn((tablo) => {
    // Bekletme ve satırlar, sorgu BAŞLADIĞI anda yakalanır (sonradan değişse de bu sorgu etkilenmez)
    const kapi = tablo === 'channels' ? fake.channelsGate : null
    const satirlar = fake.rows[tablo] ?? []
    const zincir = {
      select: () => zincir, eq: () => zincir, lt: () => zincir, in: () => zincir,
      order: () => zincir, limit: () => zincir,
      then: async (res) => {
        if (kapi) await kapi
        return res({ data: satirlar, error: null })
      },
    }
    return zincir
  })
  fake.voice = 0 // açık sesli kanal (voice:<id>) sinyal aboneliği sayısı
  fake.voiceTopics = []
  fake.tracked = []
  fake.channel = vi.fn((ad) => {
    // presence:voxen ve voice:<id> ayrı kanallar: sohbet abonelik sayacına katılmaz
    const sesli = ad.startsWith('voice:')
    const k = {
      on: (_t, _f, cb) => { if (ad === 'presence:voxen') fake.syncCb = cb; return k },
      // Varlık kanalı hemen bağlanır (track çağrılarını görebilmek için)
      subscribe: (cb) => { if (ad === 'presence:voxen') cb?.('SUBSCRIBED'); return k },
      send: () => Promise.resolve(),
      track: (d) => { fake.tracked.push(d) },
      untrack: () => {},
      presenceState: () => fake.presenceState ?? {},
      presence: ad === 'presence:voxen',
      sesli,
    }
    if (sesli) { fake.voice++; fake.voiceTopics.push(ad) } else if (!k.presence) fake.subs++
    return k
  })
  return {
    supabase: {
      rpc: vi.fn(),
      from: (...a) => fake.from(...a),
      channel: (...a) => fake.channel(...a),
      removeChannel: (k) => { if (k?.sesli) fake.voice--; else if (!k?.presence) fake.subs-- },
    },
  }
})

import { startApp, stopApp } from '../src/ui/app.js'

const profil = { id: 'u1', username: 'berk', color: '#5b7cfa' }
const bosalt = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const kanallar = [
  { id: 'a', server_id: 's1', name: 'genel', kind: 'text', position: 0 },
  { id: 'b', server_id: 's1', name: 'sohbet', kind: 'text', position: 1 },
  { id: 'v', server_id: 's1', name: 'Lobi', kind: 'voice', position: 2 },
]

beforeEach(async () => {
  // Önceki testte açık kalan sesli oturum varsa şimdi kapansın (sayaçlar sıfırlanmadan önce).
  // Kanal bırakma asenkron olduğu için bitmesini bekle.
  window.dispatchEvent(new Event('pagehide'))
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  fake.rows = {
    servers: [{ id: 's1', name: 'S', owner_id: 'u1', invite_code: 'k' }],
    channels: kanallar,
  }
  fake.subs = 0
  fake.voice = 0
  fake.voiceTopics = []
  fake.tracked = []
  fake.channelsGate = null
  localStorage.clear()
  sessionStorage.clear()
  location.hash = ''
  document.body.innerHTML = '<div id="app"></div>'
})

const kanalaTikla = (ad) =>
  [...document.querySelectorAll('.channel-item')].find((b) => b.textContent.includes(ad)).click()

describe('startApp sohbet bağlantısı', () => {
  it('yazılı kanal açılınca sohbet kurulur; kanal değişince eski abonelik kapanır', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(document.querySelector('textarea').placeholder).toBe('#genel kanalına mesaj yaz…')
    expect(fake.subs).toBe(1)
    kanalaTikla('sohbet')
    await bosalt()
    expect(document.querySelector('textarea').placeholder).toBe('#sohbet kanalına mesaj yaz…')
    expect(fake.subs).toBe(1) // sızıntı yok
  })

  it('sesli kanala tıklayınca son yazılı kanalın sohbeti kalır ve kaydedilmez', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    expect(document.querySelector('textarea').placeholder).toBe('#genel kanalına mesaj yaz…')
    expect(fake.subs).toBe(1)
    expect(JSON.parse(localStorage.getItem('voxen.last')).channelId).toBe('a')
  })

  it('sunucuSec yarışı: eski sunucunun kanal sonucu yeniyi ezmez', async () => {
    fake.rows.servers.push({ id: 's2', name: 'T', owner_id: 'u1', invite_code: 'k2' })
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    // s2'yi yavaş yükle, hemen ardından s1'e dön
    let ac
    fake.channelsGate = new Promise((r) => { ac = r })
    fake.rows.channels = [{ id: 'x', server_id: 's2', name: 'eski', kind: 'text', position: 0 }]
    const ikonlar = document.querySelectorAll('.server-icon')
    ikonlar[1].click()
    fake.channelsGate = null
    fake.rows.channels = kanallar
    ikonlar[0].click()
    await bosalt()
    ac() // yavaş olan şimdi biter
    await bosalt()
    expect(document.querySelector('textarea').placeholder).toBe('#genel kanalına mesaj yaz…')
    expect(fake.subs).toBe(1)
  })
})

describe('çevrimiçi dinleyici sızıntısı', () => {
  it('startApp iki kez çağrılınca eski dinleyici bırakılır; sadece ikincinin paneli güncellenir', async () => {
    const { presenceListenerCount } = await import('../src/presence/presence.js')
    fake.rows.server_members = [{ user_id: 'u1' }]
    fake.rows.profiles = [{ id: 'u1', username: 'berk', color: '#5b7cfa' }]
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    await startApp(document.querySelector('#a'), profil)
    await startApp(document.querySelector('#b'), profil)
    await bosalt()
    expect(presenceListenerCount()).toBe(1)
    const eskiPanel = document.querySelector('#a .member-panel')
    const yeniPanel = document.querySelector('#b .member-panel')
    fake.presenceState = { u1: [{ status: 'online', statusText: 'merhaba', voiceChannelId: null }] }
    fake.syncCb()
    expect(yeniPanel.textContent).toContain('Çevrimiçi — 1')
    expect(eskiPanel.textContent).not.toContain('Çevrimiçi')
  })
})

describe('sesli kanal', () => {
  const sesPaneli = () => document.querySelector('.voice-panel')
  const dugme = (ad) => [...sesPaneli().querySelectorAll('button')].find((b) => b.textContent === ad)

  it('sesli kanala tıklayınca katılır: ses paneli, voice:<id> sinyali ve varlıkta voiceChannelId', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    expect(fake.voiceTopics).toEqual(['voice:v'])
    expect(fake.voice).toBe(1)
    expect(sesPaneli().textContent).toContain('Lobi')
    // jsdom'da mikrofon yok: sadece dinleyici, Türkçe hata panelde
    expect(sesPaneli().textContent).toContain('Mikrofon açılamadı')
    expect(fake.tracked.at(-1).voiceChannelId).toBe('v')
    // Aynı kanala tekrar tıklamak yeniden katılmaz
    kanalaTikla('Lobi')
    await bosalt()
    expect(fake.voiceTopics).toHaveLength(1)
  })

  it('başka sesli kanala geçince önce eskisinden ayrılır', async () => {
    fake.rows.channels = [...kanallar, { id: 'w', server_id: 's1', name: 'Oyun', kind: 'voice', position: 3 }]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    kanalaTikla('Oyun')
    await bosalt()
    expect(fake.voiceTopics).toEqual(['voice:v', 'voice:w'])
    expect(fake.voice).toBe(1)
    expect(sesPaneli().textContent).toContain('Oyun')
    expect(fake.tracked.at(-1).voiceChannelId).toBe('w')
  })

  it('Ayrıl: panel kapanır, sinyal kanalı bırakılır, voiceChannelId null olur', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    dugme('Ayrıl').click()
    await bosalt()
    expect(sesPaneli()).toBeNull()
    expect(fake.voice).toBe(0)
    expect(fake.tracked.at(-1).voiceChannelId).toBeNull()
  })

  it('Sağırlaştır düğmesi basılı görünür', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    dugme('Sağırlaştır').click()
    expect(dugme('Sağırlaştır').getAttribute('aria-pressed')).toBe('true')
  })

  it('Sustur / Sağırlaştır varlığa voiceMuted / voiceDeafened yazar; Ayrıl sıfırlar', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    // jsdom'da mikrofon yok: dinleyici modu, zaten susturulmuş sayılır
    dugme('Sağırlaştır').click()
    expect(fake.tracked.at(-1)).toMatchObject({ voiceChannelId: 'v', voiceDeafened: true })
    dugme('Sağırlaştır').click()
    expect(fake.tracked.at(-1).voiceDeafened).toBe(false)
    dugme('Ayrıl').click()
    await bosalt()
    expect(fake.tracked.at(-1)).toMatchObject({ voiceChannelId: null, voiceMuted: false, voiceDeafened: false })
  })

  it('varlıktaki kişiler sesli kanalın altında listelenir', async () => {
    fake.rows.server_members = [{ user_id: 'u1' }, { user_id: 'u2' }]
    fake.rows.profiles = [profil, { id: 'u2', username: 'ali', color: '#e05b5b' }]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.presenceState = { u2: [{ status: 'online', statusText: '', voiceChannelId: 'v' }] }
    fake.syncCb()
    const lobi = document.querySelector('[data-voice-channel="v"]')
    expect(lobi.textContent).toContain('ali')
  })

  it('uygulama yeniden başlarsa (çıkış/giriş) sesli kanaldan ayrılır', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(fake.voice).toBe(0)
  })

  it('sayfa kapanırken (pagehide) ayrılır', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    window.dispatchEvent(new Event('pagehide'))
    await bosalt() // kanal bırakma asenkron
    expect(fake.voice).toBe(0)
  })
})

describe('üye listesi canlı yenileme', () => {
  const uyeSorgusu = () => fake.from.mock.calls.filter(([t]) => t === 'server_members').length

  it('varlıkta listede olmayan biri görünürse üyeler yeniden yüklenir (2 sn içinde en fazla bir kez)', async () => {
    fake.rows.server_members = [{ user_id: 'u1' }]
    fake.rows.profiles = [profil]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    const once = uyeSorgusu()
    // u2 sunucuya yeni katıldı ve çevrimiçi
    fake.rows.server_members = [{ user_id: 'u1' }, { user_id: 'u2' }]
    fake.rows.profiles = [profil, { id: 'u2', username: 'ali', color: '#e05b5b' }]
    fake.presenceState = { u2: [{ status: 'online', statusText: '', voiceChannelId: null }] }
    fake.syncCb()
    await bosalt()
    expect(uyeSorgusu()).toBe(once + 1)
    expect(document.querySelector('.member-panel').textContent).toContain('ali')
    // Hemen tekrar bilinmeyen biri: 2 sn dolmadan yeni sorgu yok
    fake.presenceState = { u2: [{ status: 'online' }], u3: [{ status: 'online' }] }
    fake.syncCb()
    await bosalt()
    expect(uyeSorgusu()).toBe(once + 1)
  })

  it('herkes zaten listedeyse yeniden yüklemez', async () => {
    fake.rows.server_members = [{ user_id: 'u1' }]
    fake.rows.profiles = [profil]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    const once = uyeSorgusu()
    fake.presenceState = { u1: [{ status: 'online' }] }
    fake.syncCb()
    await bosalt()
    expect(uyeSorgusu()).toBe(once)
  })
})

describe('oturum sonu (stopApp)', () => {
  it('stopApp sesli kanaldan ayrılır ve varlığı durdurur', async () => {
    const { presenceListenerCount } = await import('../src/presence/presence.js')
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    expect(fake.voice).toBe(1)
    stopApp()
    await bosalt()
    expect(fake.voice).toBe(0)
    expect(presenceListenerCount()).toBe(0)
    stopApp() // ikinci kez çağırmak sorun değil
  })
})

describe('aynı hesap iki pencerede', () => {
  it('başka bir pencerede sesli kanaldaysa katılmaz ve uyarır', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    // Kendi hesabımızın BAŞKA bir istemciden gelen girdisi sesli kanalda
    fake.presenceState = { u1: [{ status: 'online', voiceChannelId: 'v', clientId: 'baska-pencere' }] }
    fake.syncCb()
    kanalaTikla('Lobi')
    await bosalt()
    expect(fake.voice).toBe(0)
    expect(document.body.textContent).toContain('Bu hesap başka bir pencerede sesli kanalda')
  })
})
