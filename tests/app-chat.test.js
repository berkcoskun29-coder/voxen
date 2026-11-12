// @vitest-environment jsdom
// Uygulama + sohbet bağlantısı: kanal/sunucu değişiminde abonelik ve yarış durumları.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))

vi.mock('../src/lib/supabase.js', () => {
  fake.rows = {}
  fake.subs = 0 // açık abonelik sayısı
  fake.channelsGate = null // listChannels'ı bekletmek için
  fake.vsOps = [] // voice_states yazmaları: ['upsert', satır] | ['delete', filtre]
  fake.from = vi.fn((tablo) => {
    // Bekletme ve satırlar, sorgu BAŞLADIĞI anda yakalanır (sonradan değişse de bu sorgu etkilenmez)
    const kapi = tablo === 'channels' ? fake.channelsGate : null
    const satirlar = fake.rows[tablo] ?? []
    const filtre = {} // yalnız voice_states için uygulanır
    let islem = 'select'
    let deger = null
    let tek = false
    const zincir = {
      select: () => zincir, eq: (k, v) => { filtre[k] = v; return zincir }, lt: () => zincir, in: () => zincir,
      order: () => zincir, limit: () => zincir,
      maybeSingle: () => { tek = true; return zincir },
      upsert: (v) => { islem = 'upsert'; deger = v; return zincir },
      delete: () => { islem = 'delete'; return zincir },
      then: async (res) => {
        if (kapi) await kapi
        if (tablo === 'servers' && fake.serversError) return res({ data: null, error: { message: 'Ağ hatası' } })
        if (tablo !== 'voice_states') return res({ data: satirlar, error: null })
        const uyar = (r) => Object.entries(filtre).every(([k, v]) => r[k] === v)
        if (islem === 'upsert') {
          fake.vsOps.push(['upsert', deger])
          fake.rows.voice_states = (fake.rows.voice_states ?? []).filter((r) => r.user_id !== deger.user_id).concat([deger])
        } else if (islem === 'delete') {
          fake.vsOps.push(['delete', { ...filtre }])
          fake.rows.voice_states = (fake.rows.voice_states ?? []).filter((r) => !uyar(r))
        }
        const bulunan = satirlar.filter(uyar)
        return res({ data: tek ? (bulunan[0] ?? null) : bulunan, error: null })
      },
    }
    return zincir
  })
  fake.voice = 0 // açık sesli kanal (voice:<id>) sinyal aboneliği sayısı
  fake.voiceTopics = []
  fake.tracked = []
  fake.vs = 0 // açık voice_states aboneliği sayısı
  fake.vsTopics = []
  fake.vsHandlers = [] // { server, cb } (sunucuya göre filtreli olaylar)
  fake.channel = vi.fn((ad) => {
    // presence:voxen, voice:<id> ve voice_states:<sunucu> ayrı kanallar: sohbet abonelik sayacına katılmaz
    const sesli = ad.startsWith('voice:')
    const vsKanal = ad.startsWith('voice_states:')
    const k = {
      on: (_t, f, cb) => {
        if (ad === 'presence:voxen') fake.syncCb = cb
        if (vsKanal && f.filter) fake.vsHandlers.push({ server: f.filter.replace('server_id=eq.', ''), cb, k })
        return k
      },
      // Varlık ve sesli durum kanalları hemen bağlanır
      subscribe: (cb) => {
        if (ad === 'presence:voxen') cb?.('SUBSCRIBED')
        if (vsKanal) Promise.resolve().then(() => { if (!k.kapandi) cb?.('SUBSCRIBED') })
        return k
      },
      send: () => Promise.resolve(),
      track: (d) => { fake.tracked.push(d) },
      untrack: () => {},
      presenceState: () => fake.presenceState ?? {},
      presence: ad === 'presence:voxen',
      sesli,
      vsKanal,
    }
    if (sesli) { fake.voice++; fake.voiceTopics.push(ad) } else if (vsKanal) { fake.vs++; fake.vsTopics.push(ad) } else if (!k.presence) fake.subs++
    return k
  })
  return {
    supabase: {
      rpc: vi.fn(),
      from: (...a) => fake.from(...a),
      channel: (...a) => fake.channel(...a),
      removeChannel: (k) => {
        if (k?.sesli) fake.voice--
        else if (k?.vsKanal) { fake.vs--; k.kapandi = true; fake.vsHandlers = fake.vsHandlers.filter((h) => h.k !== k) }
        else if (!k?.presence) fake.subs--
      },
    },
  }
})

// Görüntü bölmesinin eş listesini (getPeers) testten okuyabilmek için kurulumu yakala
vi.mock('../src/ui/videoPane.js', async (asil) => {
  const m = await asil()
  return { ...m, mountVideoPane: (kap, ayar) => { fake.paneOpts = ayar; return m.mountVideoPane(kap, ayar) } }
})

// Sesli oturumu yakala: odadaki ekran paylaşımı bildirimini (setRoomScreenOn) görmek için
vi.mock('../src/voice/session.js', async (asil) => {
  const m = await asil()
  return {
    ...m,
    createVoiceSession: (o) => {
      const s = m.createVoiceSession(o)
      const asilFn = s.setRoomScreenOn
      s.setRoomScreenOn = vi.fn((b) => asilFn?.(b))
      fake.oturum = s
      return s
    },
  }
})

// Profil penceresi: kaydet geri çağrısını yakala (karşılama kartındaki ad tazelensin mi testi)
vi.mock('../src/auth/profileModal.js', () => ({ openProfileModal: vi.fn() }))

// Çıkış: signOut çağrıldığı anda sesli durum silmesi gitmiş olmalı
vi.mock('../src/auth/auth.js', async (asil) => ({
  ...(await asil()),
  signOut: vi.fn(async () => { fake.signOutAnindaOps = fake.vsOps.map(([o]) => o) }),
}))

import { startApp, stopApp, appTiming } from '../src/ui/app.js'
import { supabase } from '../src/lib/supabase.js'
import { openProfileModal } from '../src/auth/profileModal.js'
import { presenceLimits, CLIENT_ID } from '../src/presence/presence.js'
import { voiceStateTiming, resetVoiceStateWriter } from '../src/data/voiceStates.js'
import { getSettings } from '../src/settings.js'

// Bu dosya varlık gönderim sınırını denemiyor (o: tests/presenceRateLimit.test.js);
// burada her değişikliğin hemen gönderildiğini görmek için sınırı kaldırıyoruz.
presenceLimits.maxCalls = Infinity
presenceLimits.gapMs = 0
voiceStateTiming.coalesceMs = 0 // sesli durum yazmaları beklemeden gitsin
appTiming.staleWindowGraceMs = 0 // kapanan penceremizin satırını beklemeden sil

// Sesli durum tablosuna gelen son yazma ve sunucudan gelen bir değişiklik olayı
const sonYazma = () => fake.vsOps.at(-1)
const vsSatir = (userId, ek = {}) => ({
  user_id: userId, server_id: 's1', channel_id: 'v', client_id: 'c-' + userId,
  muted: false, deafened: false, camera: false, screen: false, ...ek,
})
function vsOlay(eventType, satir) {
  for (const h of fake.vsHandlers) if (h.server === satir.server_id) h.cb({ eventType, new: satir, old: { user_id: satir.user_id } })
}

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
  fake.serversError = false
  fake.vsOps = []
  fake.vsTopics = []
  fake.presenceState = undefined
  resetVoiceStateWriter()
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
  // Sustur / Sağırlaştır kullanıcı çubuğunda, diğerleri ses panelinde
  const dugme = (ad) => [...document.querySelectorAll('.voice-panel button, .user-bar button')].find((b) => b.dataset.ad === ad)

  it('sesli kanala tıklayınca katılır: ses paneli, voice:<id> sinyali ve voice_states satırı', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    expect(fake.voiceTopics).toEqual(['voice:v'])
    expect(fake.voice).toBe(1)
    expect(sesPaneli().textContent).toContain('Lobi')
    // jsdom'da mikrofon yok: sadece dinleyici, Türkçe hata panelde
    expect(sesPaneli().textContent).toContain('Mikrofon açılamadı')
    expect(sonYazma()).toEqual(['upsert', expect.objectContaining({ user_id: 'u1', server_id: 's1', channel_id: 'v', client_id: CLIENT_ID })])
    // Varlık (presence) artık sesli kanal bilgisi taşımaz
    expect(fake.tracked.some((d) => 'voiceChannelId' in d || 'voiceMuted' in d)).toBe(false)
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
    expect(sonYazma()).toEqual(['upsert', expect.objectContaining({ channel_id: 'w' })])
  })

  it('Ayrıl: panel kapanır, sinyal kanalı bırakılır, sesli durum satırı silinir', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    dugme('Ayrıl').click()
    await bosalt()
    expect(sesPaneli()).toBeNull()
    expect(fake.voice).toBe(0)
    expect(sonYazma()).toEqual(['delete', { user_id: 'u1', client_id: CLIENT_ID }])
  })

  it('Sağırlaştır düğmesi basılı görünür', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    dugme('Sağırlaştır').click()
    expect(dugme('Sağırlaştır').getAttribute('aria-pressed')).toBe('true')
  })

  it('Sustur / Sağırlaştır voice_states satırına yazılır; Ayrıl satırı siler', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    // jsdom'da mikrofon yok: dinleyici modu, zaten susturulmuş sayılır
    dugme('Sağırlaştır').click()
    await bosalt()
    expect(sonYazma()).toEqual(['upsert', expect.objectContaining({ channel_id: 'v', deafened: true })])
    dugme('Sağırlaştır').click()
    await bosalt()
    expect(sonYazma()[1].deafened).toBe(false)
    dugme('Ayrıl').click()
    await bosalt()
    expect(sonYazma()[0]).toBe('delete')
  })

  it('kendi satırımız sunucudan gelmeden de kanal listesinde anında doğru simgeyle görünür', async () => {
    fake.rows.server_members = [{ user_id: 'u1' }]
    fake.rows.profiles = [profil]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    dugme('Sağırlaştır').click()
    const lobi = document.querySelector('[data-voice-channel="v"]')
    expect(lobi.textContent).toContain('berk')
    expect(lobi.querySelector('svg[data-state="deafened"]')).not.toBeNull()
  })

  it('voice_states satırı olan ve çevrimiçi olan kişiler sesli kanalın altında listelenir', async () => {
    fake.rows.server_members = [{ user_id: 'u1' }, { user_id: 'u2' }]
    fake.rows.profiles = [profil, { id: 'u2', username: 'ali', color: '#e05b5b' }]
    fake.rows.voice_states = [vsSatir('u2', { muted: true })]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(fake.vsTopics.every((t) => t.startsWith('voice_states:s1:'))).toBe(true)
    expect(fake.vs).toBe(1)
    const lobi = () => document.querySelector('[data-voice-channel="v"]')
    expect(lobi().textContent).not.toContain('ali') // satırı var ama çevrimiçi değil (eski satır)
    fake.presenceState = { u2: [{ status: 'online', statusText: '', clientId: 'c-u2' }] } // satırı yazan pencere açık
    fake.syncCb()
    expect(lobi().textContent).toContain('ali')
    expect(lobi().querySelector('svg[data-state="muted"]')).not.toBeNull()
    // Canlı değişiklik: kamerasını açtı, sonra ayrıldı
    vsOlay('UPDATE', vsSatir('u2', { camera: true }))
    expect(lobi().querySelector('svg[data-state="camera"]')).not.toBeNull()
    for (const h of fake.vsHandlers) h.cb({ eventType: 'DELETE', new: {}, old: { user_id: 'u2' } })
    expect(lobi().textContent).not.toContain('ali')
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

describe('sesli kanaldayken başka sunucuya bakmak', () => {
  it('görüntü bölmesi sesli sunucunun kişilerini ve durumlarını göstermeye devam eder', async () => {
    fake.rows.servers.push({ id: 's2', name: 'T', owner_id: 'u1', invite_code: 'k2' })
    fake.rows.server_members = [{ user_id: 'u1' }, { user_id: 'u2' }]
    fake.rows.profiles = [profil, { id: 'u2', username: 'ali', color: '#e05b5b' }]
    fake.rows.voice_states = [vsSatir('u2', { camera: true })]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.presenceState = { u1: [{ status: 'online', clientId: CLIENT_ID }], u2: [{ status: 'online', clientId: 'c-u2' }] }
    fake.syncCb()
    kanalaTikla('Lobi')
    await bosalt()
    const kisiler = () => fake.paneOpts.getPeers().map((p) => [p.name, p.camera])
    expect(kisiler()).toEqual([['berk', false], ['ali', true]])
    // Başka sunucuya geç: orada ali üye değil
    fake.rows.server_members = [{ user_id: 'u1' }]
    fake.rows.profiles = [profil]
    fake.rows.channels = [{ id: 'x', server_id: 's2', name: 'baska', kind: 'text', position: 0 }]
    document.querySelectorAll('.server-icon')[1].click()
    await bosalt()
    expect(document.querySelector('textarea').placeholder).toBe('#baska kanalına mesaj yaz…')
    expect(kisiler()).toEqual([['berk', false], ['ali', true]]) // bölme boşalmadı
    expect(fake.vs).toBe(2) // seçili sunucu + sesli kanalımızın sunucusu dinleniyor
    // Ayrılınca yalnız seçili sunucu dinlenir
    ;[...document.querySelector('.voice-panel').querySelectorAll('button')].find((b) => b.dataset.ad === 'Ayrıl').click()
    await bosalt()
    expect(fake.vs).toBe(1)
  })
})

describe('odada ekran paylaşımı (kamera bütçesi)', () => {
  it('kanalımızda biri ekran paylaşınca oturuma bildirilir; bitince kaldırılır; başka kanaldaki sayılmaz', async () => {
    fake.rows.channels = [...kanallar, { id: 'w', server_id: 's1', name: 'Oyun', kind: 'voice', position: 3 }]
    fake.rows.server_members = [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }]
    fake.rows.profiles = [profil, { id: 'u2', username: 'ali', color: '#e05b5b' }, { id: 'u3', username: 'can', color: '#3be37a' }]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.presenceState = { u2: [{ status: 'online', clientId: 'c-u2' }], u3: [{ status: 'online', clientId: 'c-u3' }] }
    fake.syncCb()
    kanalaTikla('Lobi')
    await bosalt()
    const son = () => fake.oturum.setRoomScreenOn.mock.calls.at(-1)?.[0] ?? false
    expect(son()).toBe(false)
    vsOlay('INSERT', vsSatir('u3', { channel_id: 'w', screen: true })) // başka kanalda
    expect(son()).toBe(false)
    vsOlay('INSERT', vsSatir('u2', { screen: true })) // bizim kanalımızda
    expect(son()).toBe(true)
    vsOlay('UPDATE', vsSatir('u2', { screen: false }))
    expect(son()).toBe(false)
  })
})

describe('pencere başına hayalet', () => {
  it('satırı yazan pencere kapandıysa kişi başka pencereden çevrimiçi olsa da kanalda görünmez ve ekranı sayılmaz', async () => {
    fake.rows.server_members = [{ user_id: 'u1' }, { user_id: 'u2' }]
    fake.rows.profiles = [profil, { id: 'u2', username: 'ali', color: '#e05b5b' }]
    fake.rows.voice_states = [vsSatir('u2', { client_id: 'ali-A', screen: true })]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    const lobi = () => document.querySelector('[data-voice-channel="v"]')
    // ali'nin A penceresi açık: görünür
    fake.presenceState = { u2: [{ status: 'online', clientId: 'ali-A' }, { status: 'online', clientId: 'ali-B' }] }
    fake.syncCb()
    expect(lobi().textContent).toContain('ali')
    kanalaTikla('Lobi')
    await bosalt()
    const son = () => fake.oturum.setRoomScreenOn.mock.calls.at(-1)?.[0] ?? false
    expect(son()).toBe(true)
    // A kapandı (silmesi gidemedi), B açık: ali artık kanalda görünmez, ekranı sayılmaz
    fake.presenceState = { u2: [{ status: 'online', clientId: 'ali-B' }] }
    fake.syncCb()
    expect(lobi().textContent).not.toContain('ali')
    expect(son()).toBe(false)
  })

  it('kendi penceremizden biri varlıktan düşerse onun satırını biz sileriz', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.presenceState = { u1: [{ status: 'online', clientId: CLIENT_ID }, { status: 'online', clientId: 'masaustu' }] }
    fake.syncCb()
    await bosalt()
    expect(fake.vsOps).toEqual([])
    fake.presenceState = { u1: [{ status: 'online', clientId: CLIENT_ID }] } // masaüstü kapandı
    fake.syncCb()
    await bosalt()
    expect(fake.vsOps).toEqual([['delete', { user_id: 'u1', client_id: 'masaustu' }]])
  })

  it('düşen pencere bekleme süresi içinde geri gelirse satırı silinmez', async () => {
    appTiming.staleWindowGraceMs = 50
    try {
      await startApp(document.querySelector('#app'), profil)
      await bosalt()
      const iki = { u1: [{ status: 'online', clientId: CLIENT_ID }, { status: 'online', clientId: 'masaustu' }] }
      fake.presenceState = iki
      fake.syncCb()
      fake.presenceState = { u1: [{ status: 'online', clientId: CLIENT_ID }] }
      fake.syncCb()
      fake.presenceState = iki // kısa kopukluk: geri geldi
      fake.syncCb()
      await new Promise((r) => setTimeout(r, 80))
      expect(fake.vsOps).toEqual([])
    } finally { appTiming.staleWindowGraceMs = 0 }
  })
})

describe('çıkış', () => {
  it('Çıkış: sesli durum satırı silindikten SONRA oturum kapanır', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    fake.signOutAnindaOps = null
    // Çıkış artık kullanıcı çubuğunda değil, Ayarlar > Hesap'ta
    expect(document.querySelector('.user-bar button[title="Çıkış"]')).toBeNull()
    document.querySelector('.user-bar button[title="Ayarlar"]').click()
    ;[...document.querySelectorAll('.modal-back button')].find((b) => b.textContent === 'Çıkış yap').click()
    // Önce onay sorulur ("Çıkış yapılsın mı?"); onaydaki kırmızı düğme çıkışı başlatır
    const onay = [...document.querySelectorAll('.modal-back')].at(-1) // en üstteki pencere
    expect(onay.querySelector('h2').textContent).toBe('Çıkış yapılsın mı?')
    ;[...onay.querySelectorAll('button')].find((b) => b.textContent === 'Çıkış yap').click()
    await bosalt()
    expect(fake.signOutAnindaOps).not.toBeNull()
    expect(fake.signOutAnindaOps.at(-1)).toBe('delete')
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
    // Kendi satırımızı BAŞKA bir pencere yazmış ve o pencere hâlâ açık (varlıkta görünüyor)
    fake.rows.voice_states = [vsSatir('u1', { client_id: 'baska-pencere' })]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.presenceState = { u1: [{ status: 'online', clientId: 'baska-pencere' }] }
    fake.syncCb()
    kanalaTikla('Lobi')
    await bosalt()
    expect(fake.voice).toBe(0)
    expect(document.body.textContent).toContain('Bu hesap başka bir pencerede sesli kanalda')
  })

  it('satırı yazan pencere artık açık değilse (eski satır) katılır', async () => {
    fake.rows.voice_states = [vsSatir('u1', { client_id: 'kapanmis-pencere' })]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    expect(fake.voice).toBe(1)
    expect(sonYazma()).toEqual(['upsert', expect.objectContaining({ client_id: CLIENT_ID })])
  })

  it('açılışta kapanmış pencereden kalan kendi satırımız silinir (açık penceresininki silinmez)', async () => {
    fake.rows.voice_states = [vsSatir('u1', { client_id: 'kapanmis-pencere' })]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(fake.vsOps).toEqual([]) // varlık gelmeden kimin açık olduğunu bilmiyoruz: dokunma
    // Varlık geldi: kendimiz görünüyoruz, eski pencere görünmüyor
    fake.presenceState = { u1: [{ status: 'online', clientId: CLIENT_ID }] }
    fake.syncCb()
    await bosalt()
    expect(fake.vsOps).toEqual([['delete', { user_id: 'u1', client_id: 'kapanmis-pencere' }]])
  })

  it('açılışta kendi satırımızı açık olan başka pencere yazdıysa silinmez', async () => {
    fake.rows.voice_states = [vsSatir('u1', { client_id: 'baska-pencere' })]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.presenceState = { u1: [{ status: 'online', clientId: CLIENT_ID }, { status: 'online', clientId: 'baska-pencere' }] }
    fake.syncCb()
    await bosalt()
    expect(fake.vsOps).toEqual([])
  })
})

describe('karşılama kartı (T01)', () => {
  it('hiç sunucu yokken ana alanda selam ve iki düğme görünür', async () => {
    fake.rows.servers = []
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    const kart = document.querySelector('.chat-host .welcome-card')
    expect(kart).not.toBeNull()
    expect(kart.querySelector('h2').textContent).toBe("Voxen'e hoş geldin, berk!")
    expect(document.querySelector('textarea')).toBeNull() // sohbet yok
  })

  it('"Sunucu oluştur" ve "Davetle katıl" mevcut pencereleri açar', async () => {
    fake.rows.servers = []
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    document.querySelector('.welcome-create').click()
    expect(document.querySelector('.modal-title').textContent).toBe('Sunucu oluştur')
    document.querySelector('.modal-back').remove()
    document.querySelector('.welcome-join').click()
    expect(document.querySelector('.modal-title').textContent).toBe('Sunucuya katıl')
  })

  it('profil adı değişince karşılama kartındaki ad tazelenir', async () => {
    fake.rows.servers = []
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    // Ayarlar > Profil: profil penceresi (sahte) açılır; kaydet geri çağrısını yeni adla çağır
    document.querySelector('.user-bar button[title="Ayarlar"]').click()
    ;[...document.querySelectorAll('.modal-back button')].find((b) => b.textContent === 'Profili düzenle').click()
    const kaydet = openProfileModal.mock.calls.at(-1)[1]
    kaydet({ ...profil, username: 'yeniad' })
    expect(document.querySelector('.welcome-card h2').textContent).toBe("Voxen'e hoş geldin, yeniad!")
  })

  it('sunucular yüklenemezse karşılama kartı yerine hata ve "Yeniden dene" görünür', async () => {
    fake.rows.servers = []
    fake.serversError = true
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(document.querySelector('.welcome-card')).toBeNull()
    expect(document.querySelector('.load-error')).not.toBeNull()
    fake.serversError = false
    document.querySelector('.load-error button').click()
    await bosalt()
    expect(document.querySelector('.load-error')).toBeNull()
    expect(document.querySelector('.welcome-card')).not.toBeNull()
  })

  it('yeniden dene başarılı olunca sunucu varsa sohbet açılır', async () => {
    fake.serversError = true
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.serversError = false
    document.querySelector('.load-error button').click()
    await bosalt()
    expect(document.querySelector('textarea').placeholder).toBe('#genel kanalına mesaj yaz…')
  })

  it('adresteki davetle katılırken karşılama kartı yanıp sönmez; davet geçersizse sonra görünür', async () => {
    fake.rows.servers = []
    location.hash = '#/davet/KOD1'
    let bitir
    supabase.rpc.mockImplementationOnce(() => new Promise((r) => { bitir = r }))
    const bitti = startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(document.querySelector('.welcome-card')).toBeNull() // katılma sürüyor
    bitir({ data: null, error: { message: 'geçersiz' } })
    await bitti
    await bosalt()
    expect(document.querySelector('.welcome-card')).not.toBeNull()
  })

  it('sunucu varken karşılama kartı yok', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(document.querySelector('.welcome-card')).toBeNull()
  })
})

describe('Üyeler düğmesi sohbet başlığında (T12)', () => {
  it('başlığın sağında; üye panelini açıp kapatır, kanal değişince de yerinde', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    const panel = document.querySelector('.member-panel')
    let dugme = document.querySelector('.main-header .members-toggle')
    expect(dugme).not.toBeNull()
    expect(panel.hidden).toBe(false)
    dugme.click()
    expect(panel.hidden).toBe(true)
    expect(dugme.getAttribute('aria-pressed')).toBe('false')
    kanalaTikla('sohbet')
    await bosalt()
    dugme = document.querySelector('.main-header .members-toggle')
    expect(dugme.getAttribute('aria-pressed')).toBe('false')
    dugme.click()
    expect(panel.hidden).toBe(false)
  })
})

describe('tasarım turu 2: çubukta sustur/sağırlaştır, profil kartı, sunucusuz düzen', () => {
  const cubukDugmesi = (ad) => [...document.querySelectorAll('.user-bar button')].find((b) => b.dataset.ad === ad)

  it('kanalda değilken Sağırlaştır tercih olarak kaydedilir ve katılınca uygulanır (voice_states dahil)', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(document.querySelector('.voice-panel')).toBeNull()
    cubukDugmesi('Sağırlaştır').click()
    expect(getSettings().deafened).toBe(true)
    expect(cubukDugmesi('Sağırlaştır').getAttribute('aria-pressed')).toBe('true')
    kanalaTikla('Lobi')
    await bosalt()
    expect(fake.oturum.getState().deafened).toBe(true)
    expect(sonYazma()).toEqual(['upsert', expect.objectContaining({ channel_id: 'v', deafened: true })])
    // Kanaldayken basınca oturum değişir, tercih de güncellenir (tek durum)
    cubukDugmesi('Sağırlaştır').click()
    await bosalt()
    expect(fake.oturum.getState().deafened).toBe(false)
    expect(getSettings().deafened).toBe(false)
    expect(sonYazma()[1].deafened).toBe(false)
  })

  it('kanalda değilken Sustur tercihi değişir; mikrofon testi çubukta yok', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(document.querySelector('.user-bar [aria-label="Mikrofon testi"]')).toBeNull()
    cubukDugmesi('Sustur').click()
    expect(getSettings().muted).toBe(true)
    expect(cubukDugmesi('Sustur').dataset.tip).toBe('Mikrofonu aç')
  })

  it('sunucu yokken üye paneli ve şeritteki ayraç gizli, kanal panelinde yinelenen yazı yok', async () => {
    fake.rows.servers = []
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(document.querySelector('.member-panel').classList.contains('sunucusuz')).toBe(true)
    expect(document.querySelector('.rail-separator')).toBeNull()
    expect(document.querySelector('.channel-panel').textContent).not.toContain('Henüz sunucun yok')
    // Varlık değişince üye listesi yeniden çizilir: panel yine gizli kalmalı
    fake.presenceState = { u1: [{ status: 'online', statusText: '', clientId: CLIENT_ID }] }
    fake.syncCb()
    await bosalt()
    expect(document.querySelector('.member-panel').classList.contains('sunucusuz')).toBe(true)
  })

  it('sunucu varken üye paneli görünür', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(document.querySelector('.member-panel').classList.contains('sunucusuz')).toBe(false)
  })

  it('M10: sağırken Sustur sağırlığı da kaldırır (tercih ve simge)', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    cubukDugmesi('Sağırlaştır').click() // kanalda değil: tercih sağır olur
    expect(getSettings().deafened).toBe(true)
    cubukDugmesi('Sustur').click()
    expect(getSettings().deafened).toBe(false)
    expect(getSettings().muted).toBe(false)
    expect(cubukDugmesi('Sağırlaştır').getAttribute('aria-pressed')).toBe('false')
  })

  it('M2: çevrimdışı kişinin takılı kalmış ses satırı kartta "Sesli kanalda" göstermez', async () => {
    fake.rows.server_members = [{ user_id: 'u1' }, { user_id: 'u2' }]
    fake.rows.profiles = [profil, { id: 'u2', username: 'ali', color: '#e05b5b' }]
    fake.rows.voice_states = [vsSatir('u2')]
    fake.presenceState = { u1: [{ status: 'online', statusText: '', clientId: CLIENT_ID }] } // u2 çevrimdışı
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.syncCb?.()
    await bosalt()
    const av = [...document.querySelectorAll('.member-panel [data-profile-opener]')].find((e) => e.getAttribute('aria-label') === 'ali profilini göster')
    av.click()
    const kart = document.querySelector('.profile-card')
    expect(kart.textContent).toContain('Çevrimdışı')
    expect(kart.querySelector('.profile-card-voice')).toBeNull()
  })

  it('üye listesindeki avatara tıklayınca profil kartı açılır (durum ve sesli kanal)', async () => {
    fake.rows.server_members = [{ user_id: 'u1' }, { user_id: 'u2' }]
    fake.rows.profiles = [profil, { id: 'u2', username: 'ali', color: '#e05b5b' }]
    fake.rows.voice_states = [vsSatir('u2')]
    fake.presenceState = {
      u1: [{ status: 'online', statusText: '', clientId: CLIENT_ID }],
      u2: [{ status: 'idle', statusText: 'yemekte', clientId: 'c-u2' }],
    }
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.syncCb?.()
    await bosalt()
    const av = [...document.querySelectorAll('.member-panel [data-profile-opener]')].find((e) => e.getAttribute('aria-label') === 'ali profilini göster')
    av.click()
    const kart = document.querySelector('.profile-card')
    expect(kart.querySelector('.profile-card-name').textContent).toBe('ali')
    expect(kart.textContent).toContain('Boşta')
    expect(kart.textContent).toContain('yemekte')
    expect(kart.querySelector('.profile-card-voice').textContent).toContain('Lobi')
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(document.querySelector('.profile-card')).toBeNull()
  })
})

describe('kendi profil kartı (tasarım 3)', () => {
  it('çubuktaki avatara tıklayınca kendi kartı açılır; Rahatsız etmeyin tercihi yazılır, Profili düzenle pencereyi açar', async () => {
    await startApp(document.querySelector('#app'), profil, { email: 'berk@ornek.com' })
    await bosalt()
    document.querySelector('.user-bar .avatar-wrap').click()
    const kart = document.querySelector('.profile-card')
    expect(kart.querySelector('.profile-card-edit')).not.toBeNull()
    kart.querySelector('[data-durum=dnd]').click()
    expect(JSON.parse(localStorage.getItem('voxen.presence')).dnd).toBe(true)
    kart.querySelector('.profile-card-edit').click()
    expect(openProfileModal).toHaveBeenCalled()
  })
})
