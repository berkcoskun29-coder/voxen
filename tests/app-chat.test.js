// @vitest-environment jsdom
// Uygulama + sohbet bağlantısı: kanal/sunucu değişiminde abonelik ve yarış durumları.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => ({}))

vi.mock('../src/lib/supabase.js', () => {
  fake.rows = {}
  fake.subs = 0 // açık abonelik sayısı
  fake.channelsGate = null // listChannels'ı bekletmek için
  fake.vsOps = [] // voice_states yazmaları: ['upsert', satır] | ['delete', filtre]
  fake.from = vi.fn((tablo) => {
    // Bekletme ve satırlar, sorgu BAŞLADIĞI anda yakalanır (sonradan değişse de bu sorgu etkilenmez)
    const kapi = tablo === 'channels' ? fake.channelsGate : tablo === 'server_members' ? fake.membersGate : null
    const satirlar = fake.rows[tablo] ?? []
    const filtre = {} // yalnız voice_states için uygulanır
    let islem = 'select'
    let deger = null
    let tek = false
    const zincir = {
      select: () => zincir, eq: (k, v) => { filtre[k] = v; return zincir }, lt: () => zincir, in: () => zincir, is: () => zincir,
      order: () => zincir, limit: () => zincir,
      maybeSingle: () => { tek = true; return zincir },
      upsert: (v) => { islem = 'upsert'; deger = v; return zincir },
      insert: (v) => { (fake.inserts ??= []).push([tablo, v]); return zincir }, // server_mutes (sessize alma)
      delete: () => { islem = 'delete'; return zincir },
      then: async (res) => {
        if (kapi) await kapi
        if (tablo === 'servers' && fake.serversError) return res({ data: null, error: { message: 'Ağ hatası' } })
        if (tablo === 'dm_calls') return res({ data: tek ? (satirlar[0] ?? null) : satirlar, error: null }) // getCallStatus
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
  fake.all = 0 // açık messages-all:<n> (okunmamış sayacı) aboneliği sayısı
  fake.allHandlers = {} // { INSERT: cb, UPDATE: cb }
  fake.srv = 0 // açık server:<id> olay aboneliği sayısı
  fake.srvTopics = []
  fake.srvHandlers = [] // { server, cb, k }
  fake.vs = 0 // açık voice_states aboneliği sayısı
  fake.vsTopics = []
  fake.vsHandlers = [] // { server, cb } (sunucuya göre filtreli olaylar)
  fake.channel = vi.fn((ad) => {
    // presence:voxen, voice:<id> ve voice_states:<sunucu> ayrı kanallar: sohbet abonelik sayacına katılmaz
    const sesli = ad.startsWith('voice:')
    const vsKanal = ad.startsWith('voice_states:')
    const srvKanal = ad.startsWith('server:') // sunucu olayları (serverEvents.js)
    const tumuKanal = ad.startsWith('messages-all:') // okunmamış sayacı: tek abonelik (data/reads.js)
    const kisiKanal = ad.startsWith('user:') // kişiye özel olaylar (data/userEvents.js): sohbet sayılmaz
    const dmTumu = ad.startsWith('dm-messages-all:') // DM sayacı: tek abonelik (data/dms.js): sohbet sayılmaz
    const k = {
      on: (_t, f, cb) => {
        if (srvKanal) fake.srvHandlers.push({ server: ad.slice(7), cb, k })
        if (tumuKanal) fake.allHandlers[f.event] = cb
        if (ad === 'presence:voxen') fake.syncCb = cb
        if (kisiKanal) fake.userCb = cb
        if (kisiKanal) (fake.userHandlers ??= {})[f.event] = cb // "arama" olayları (DM araması) da bu konudan
        if (dmTumu) fake.dmAllHandlers[f.event] = cb
        if (ad.startsWith('dm-messages:') && f.event === 'INSERT') fake.dmChatInsert = cb
        if (vsKanal && f.filter) fake.vsHandlers.push({ server: f.filter.replace('server_id=eq.', ''), cb, k })
        return k
      },
      // Varlık ve sesli durum kanalları hemen bağlanır
      subscribe: (cb) => {
        if (ad === 'presence:voxen' || tumuKanal) cb?.('SUBSCRIBED')
        if (vsKanal) Promise.resolve().then(() => { if (!k.kapandi) cb?.('SUBSCRIBED') })
        if (dmTumu) { fake.dmAllSub = cb; cb?.('SUBSCRIBED') }
        return k
      },
      send: () => Promise.resolve(),
      track: (d) => { fake.tracked.push(d) },
      untrack: () => {},
      presenceState: () => fake.presenceState ?? {},
      presence: ad === 'presence:voxen',
      sesli,
      vsKanal,
      srvKanal,
      tumuKanal,
      kisiKanal,
      dmTumu,
    }
    if (tumuKanal) { fake.all++; return k }
    if (kisiKanal) { fake.user = (fake.user ?? 0) + 1; return k }
    if (dmTumu) { fake.dmAll = (fake.dmAll ?? 0) + 1; return k }
    if (srvKanal) { fake.srv++; fake.srvTopics.push(ad) } else if (sesli) { fake.voice++; fake.voiceTopics.push(ad) } else if (vsKanal) { fake.vs++; fake.vsTopics.push(ad) } else if (!k.presence) fake.subs++
    return k
  })
  return {
    supabase: {
      rpc: vi.fn(),
      from: (...a) => fake.from(...a),
      channel: (...a) => fake.channel(...a),
      removeChannel: (k) => {
        if (k?.tumuKanal) { fake.all--; fake.allHandlers = {} }
        else if (k?.kisiKanal) fake.user--
        else if (k?.dmTumu) { fake.dmAll--; fake.dmAllHandlers = {} }
        else if (k?.srvKanal) { fake.srv--; fake.srvHandlers = fake.srvHandlers.filter((h) => h.k !== k) }
        else if (k?.sesli) fake.voice--
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
      if (fake.joinHatasi) s.join = () => Promise.reject(new Error('katılamadı')) // DM araması: katılma hatası
      const asilFn = s.setRoomScreenOn
      s.setRoomScreenOn = vi.fn((b) => asilFn?.(b))
      fake.oturum = s
      return s
    },
  }
})

// Döngülü sesleri (bekleme tonu, gelen arama zili) yakala: hangi döngü başladı / durdu
vi.mock('../src/voice/sounds.js', async (asil) => {
  const m = await asil()
  return {
    ...m,
    startLoop: (ad, d) => {
      const kayit = { ad, durdu: false }
      ;(fake.donguler ??= []).push(kayit)
      const durdur = m.startLoop(ad, d)
      return () => { kayit.durdu = true; durdur() }
    },
  }
})

// Profil penceresi: kaydet geri çağrısını yakala (karşılama kartındaki ad tazelensin mi testi)
// "yazıyor" kanalı bu testlerin konusu değil: kanal sayımları bozulmasın diye sahtesi (bkz. typingUi.test.js)
vi.mock('../src/data/typing.js', () => ({
  typingTiming: { sendEveryMs: 3000, expireMs: 5000 },
  joinTyping: () => {
    fake.typingOpen = (fake.typingOpen ?? 0) + 1 // açık "yazıyor" kanalı sayısı (stopApp kapatmalı)
    return { typing() {}, stopped() {}, clear() {}, leave: async () => { fake.typingOpen-- } }
  },
}))

vi.mock('../src/auth/profileModal.js', () => ({ openProfileModal: vi.fn() }))

// Çıkış: signOut çağrıldığı anda sesli durum silmesi gitmiş olmalı
vi.mock('../src/auth/auth.js', async (asil) => ({
  ...(await asil()),
  signOut: vi.fn(async () => { fake.signOutAnindaOps = fake.vsOps.map(([o]) => o) }),
}))

import { startApp, stopApp, appTiming } from '../src/ui/app.js'
import { readTiming, resetReads } from '../src/data/reads.js'
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
  stopApp() // önceki testin uygulaması açık kaldıysa abonelikleri ve menüleri kapat
  // Önceki testten kalan tuş seçme penceresi (yakalama aşamasında tuşları yutar) kapansın
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  supabase.rpc.mockReset()
  fake.rows = {
    servers: [{ id: 's1', name: 'S', owner_id: 'u1', invite_code: 'k' }],
    channels: kanallar,
  }
  fake.subs = 0
  fake.user = 0
  fake.userCb = null
  fake.dmAll = 0
  fake.dmAllHandlers = {}
  fake.dmAllSub = null
  fake.dmChatInsert = null
  fake.typingOpen = 0
  fake.srv = 0
  fake.srvTopics = []
  fake.srvHandlers = []
  fake.voice = 0
  fake.voiceTopics = []
  fake.tracked = []
  fake.channelsGate = null
  fake.serversError = false
  fake.vsOps = []
  fake.vsTopics = []
  fake.presenceState = undefined
  fake.inserts = []
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
    // unread_counts (okunmamış sayacı) hemen döner; katılma çağrısı bekletilir
    supabase.rpc.mockImplementation((ad) => (ad === 'unread_counts' ? Promise.resolve({ data: [], error: null }) : new Promise((r) => { bitir = r })))
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

describe('sunucu menüsü, silme/ayrılma ve canlı sunucu olayları (Görev 3)', () => {
  const menuOgesi = (yazi) => [...document.querySelectorAll('.popup-menu [role=menuitem]')].find((b) => b.textContent === yazi)
  const modalDugme = (yazi) => [...document.querySelectorAll('.modal-card button')].find((b) => b.textContent === yazi)
  const sunucuMenusunuAc = () => document.querySelector('.server-name-btn').click()
  const olayGonder = (payload = { tablo: 'channels', islem: 'DELETE' }) => { for (const h of fake.srvHandlers) h.cb({ payload }) }
  const acikBaslik = () => document.querySelector('textarea')?.placeholder

  it('her sunucu için server:<id> konusu açılır ve çıkışta kapanır', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(fake.srvTopics).toEqual(['server:s1'])
    expect(fake.srv).toBe(1)
    stopApp()
    await bosalt()
    expect(fake.srv).toBe(0)
  })

  it('sahipte menüde Davet et, Sunucu ayarları, Kanal ekle, Sunucuyu sil; üyede Sunucudan ayrıl', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    sunucuMenusunuAc()
    expect([...document.querySelectorAll('.popup-menu [role=menuitem]')].map((b) => b.textContent))
      .toEqual(['Davet et', 'Sunucuyu sessize al', 'Sunucu ayarları', 'Kanal ekle', 'Sunucuyu sil'])
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(document.querySelector('.popup-menu')).toBeNull()

    fake.rows.servers = [{ id: 's1', name: 'S', owner_id: 'baskasi', invite_code: 'k' }]
    stopApp()
    document.body.innerHTML = '<div id="app"></div>'
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    sunucuMenusunuAc()
    expect([...document.querySelectorAll('.popup-menu [role=menuitem]')].map((b) => b.textContent))
      .toEqual(['Davet et', 'Sunucuyu sessize al', 'Sunucudan ayrıl'])
    // üyede kanal ⚙ düğmesi yok
    expect(document.querySelector('.channel-gear')).toBeNull()
  })

  it('Sunucuyu sil: ad aynen yazılana kadar Sil pasif; RPC çağrılır, sunucu kalkınca karşılama ekranı çıkar', async () => {
    supabase.rpc.mockImplementation(async (ad) => { if (ad === 'delete_server') fake.rows.servers = []; return { data: null, error: null } })
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    sunucuMenusunuAc()
    menuOgesi('Sunucuyu sil').click()
    const sil = modalDugme('Sil')
    const kutu = document.querySelector('.modal-card input')
    expect(document.querySelector('.modal-card').textContent).toContain('Bu geri alınamaz. Bütün kanallar ve mesajlar silinir.')
    expect(sil.disabled).toBe(true)
    kutu.value = 's'
    kutu.dispatchEvent(new Event('input'))
    expect(sil.disabled).toBe(true)
    kutu.value = 'S'
    kutu.dispatchEvent(new Event('input'))
    expect(sil.disabled).toBe(false)
    sil.click()
    await bosalt()
    expect(supabase.rpc).toHaveBeenCalledWith('delete_server', { sid: 's1' })
    expect(document.querySelector('.modal-card')).toBeNull()
    expect(document.body.textContent).toContain('Voxen\'e hoş geldin')
    expect(fake.srv).toBe(0) // silinen sunucunun konusu kapandı
  })

  it('sesli kanaldayken sunucuyu silmek önce sesten çıkarır', async () => {
    supabase.rpc.mockImplementation(async (ad) => { if (ad === 'delete_server') fake.rows.servers = []; return { data: null, error: null } })
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    expect(document.querySelector('.voice-panel')).not.toBeNull()
    sunucuMenusunuAc()
    menuOgesi('Sunucuyu sil').click()
    const kutu = document.querySelector('.modal-card input')
    kutu.value = 'S'
    kutu.dispatchEvent(new Event('input'))
    modalDugme('Sil').click()
    await bosalt()
    expect(document.querySelector('.voice-panel')).toBeNull()
    expect(fake.voice).toBe(0)
    expect(fake.vsOps.some(([o]) => o === 'delete')).toBe(true)
    expect(document.body.textContent).not.toContain('Bu sunucu silindi.') // kendi silmemiz: bildirim yok
  })

  it('Sunucudan ayrıl: onay metni, RPC ve sıradaki sunucuya geçiş', async () => {
    fake.rows.servers = [
      { id: 's1', name: 'S', owner_id: 'baskasi', invite_code: 'k' },
      { id: 's2', name: 'İkinci', owner_id: 'baskasi', invite_code: 'k2' },
    ]
    supabase.rpc.mockImplementation(async (ad) => { if (ad === 'leave_server') fake.rows.servers = fake.rows.servers.filter((s) => s.id !== 's1'); return { data: null, error: null } })
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    sunucuMenusunuAc()
    menuOgesi('Sunucudan ayrıl').click()
    expect(document.querySelector('.modal-card').textContent).toContain('S sunucusundan ayrılınsın mı? Davet linkiyle yeniden katılabilirsin.')
    modalDugme('Ayrıl').click()
    await bosalt()
    expect(supabase.rpc).toHaveBeenCalledWith('leave_server', { sid: 's1' })
    expect(document.querySelector('.panel-top h2').textContent).toBe('İkinci')
  })

  it('RPC hatası pencerede gösterilir ve pencere açık kalır', async () => {
    fake.rows.servers = [{ id: 's1', name: 'S', owner_id: 'baskasi', invite_code: 'k' }]
    supabase.rpc.mockImplementation(async () => ({ data: null, error: { message: 'Bir sorun var' } }))
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    sunucuMenusunuAc()
    menuOgesi('Sunucudan ayrıl').click()
    modalDugme('Ayrıl').click()
    await bosalt()
    expect(document.querySelector('.modal-card .error').textContent).toBe('Bir sorun var')
  })

  it('açık kanal silinince (olayla) ilk yazılı kanala geçilir', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('sohbet')
    await bosalt()
    expect(acikBaslik()).toBe('#sohbet kanalına mesaj yaz…')
    fake.rows.channels = kanallar.filter((k) => k.id !== 'b')
    olayGonder()
    await bosalt()
    expect(acikBaslik()).toBe('#genel kanalına mesaj yaz…')
    expect(JSON.parse(localStorage.getItem('voxen.last')).channelId).toBe('a')
  })

  it('kanal ⚙ menüsü: yeniden adlandır (doğrulama + RPC) ve sil (onay + RPC)', async () => {
    supabase.rpc.mockImplementation(async (ad, arg) => {
      if (ad === 'delete_channel') fake.rows.channels = fake.rows.channels.filter((k) => k.id !== arg.cid)
      if (ad === 'rename_channel') fake.rows.channels = fake.rows.channels.map((k) => (k.id === arg.cid ? { ...k, name: arg.ad } : k))
      return { data: null, error: null }
    })
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    const dislisi = (ad) => document.querySelector(`.channel-gear[aria-label="${ad} kanal ayarları"]`)
    dislisi('sohbet').click()
    expect([...document.querySelectorAll('.popup-menu [role=menuitem]')].map((b) => b.textContent)).toEqual(['Kanalı yeniden adlandır', 'Kanalı sil'])
    menuOgesi('Kanalı yeniden adlandır').click()
    const kutu = document.querySelector('.modal-card input')
    expect(kutu.value).toBe('sohbet')
    kutu.value = '   '
    modalDugme('Kaydet').click()
    await bosalt()
    expect(document.querySelector('.modal-card .field-error').textContent).toContain('Kanal adı boş olamaz')
    expect(kutu.getAttribute('aria-invalid')).toBe('true')
    kutu.value = 'yeni-ad'
    modalDugme('Kaydet').click()
    await bosalt()
    expect(supabase.rpc).toHaveBeenCalledWith('rename_channel', { cid: 'b', ad: 'yeni-ad' })
    expect([...document.querySelectorAll('.channel-item')].some((b) => b.textContent === '# yeni-ad')).toBe(true)
    dislisi('yeni-ad').click()
    menuOgesi('Kanalı sil').click()
    expect(document.querySelector('.modal-card').textContent).toContain('#yeni-ad kanalı silinsin mi? İçindeki bütün mesajlar silinir.')
    modalDugme('Sil').click()
    await bosalt()
    expect(supabase.rpc).toHaveBeenCalledWith('delete_channel', { cid: 'b' })
    expect([...document.querySelectorAll('.channel-item')].some((b) => b.textContent.includes('yeni-ad'))).toBe(false)
  })

  it('Sunucu ayarları: ad kaydedilir (rename_server), davet kodu görünür', async () => {
    supabase.rpc.mockImplementation(async (ad, arg) => {
      if (ad === 'rename_server') fake.rows.servers = fake.rows.servers.map((s) => ({ ...s, name: arg.ad }))
      return { data: null, error: null }
    })
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    sunucuMenusunuAc()
    menuOgesi('Sunucu ayarları').click()
    expect(document.querySelector('.invite-code').textContent).toBe('k')
    expect(modalDugme('Davet linkini kopyala')).toBeTruthy()
    const kutu = document.querySelector('.modal-card input')
    kutu.value = 'Yeni Ad'
    modalDugme('Kaydet').click()
    await bosalt()
    expect(supabase.rpc).toHaveBeenCalledWith('rename_server', { sid: 's1', ad: 'Yeni Ad' })
    expect(document.querySelector('.panel-top h2').textContent).toBe('Yeni Ad')
  })

  it('sesli kanaldayken sunucu başkasınca silinirse sesten çıkılır ve "Bu sunucu silindi." gösterilir', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    expect(document.querySelector('.voice-panel')).not.toBeNull()
    fake.rows.servers = []
    olayGonder({ tablo: 'servers', islem: 'DELETE' })
    await bosalt()
    expect(document.querySelector('.voice-panel')).toBeNull()
    expect(fake.voice).toBe(0)
    expect(fake.vsOps.some(([o]) => o === 'delete')).toBe(true)
    expect([...document.querySelectorAll('.toast')].map((t) => t.textContent)).toContain('Bu sunucu silindi.')
  })

  it('pencere odağa gelince listeler tazelenir', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.rows.channels = [...kanallar, { id: 'z', server_id: 's1', name: 'yeni', kind: 'text', position: 5 }]
    window.dispatchEvent(new Event('focus'))
    await bosalt()
    expect([...document.querySelectorAll('.channel-item')].some((b) => b.textContent === '# yeni')).toBe(true)
  })

  it('kanal yeniden adlandırılınca sohbet yeniden kurulmaz: taslak ve açık düzenleme kutusu kalır', async () => {
    fake.rows.messages = [{ id: 1, channel_id: 'a', author_id: 'u1', content: 'eski mesaj', created_at: '2026-01-01T10:00:00Z' }]
    fake.rows.profiles = [{ id: 'u1', username: 'berk', color: '#5b7cfa' }]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    const anaKutu = () => [...document.querySelectorAll('textarea')].find((t) => t.placeholder.includes('kanalına'))
    const kutu = anaKutu()
    kutu.value = 'yarım kalan taslak'
    const duzenle = document.querySelector('.msg-action-duzenle')
    expect(duzenle).not.toBeNull()
    duzenle.click()
    const duzenKutusu = document.querySelector('.msg-edit-input')
    expect(duzenKutusu).not.toBeNull()
    duzenKutusu.value = 'düzenlenen metin'
    fake.rows.channels = kanallar.map((k) => (k.id === 'a' ? { ...k, name: 'ana' } : k))
    olayGonder({ tablo: 'channels', islem: 'UPDATE' })
    await bosalt()
    expect(anaKutu()).toBe(kutu) // aynı düğüm: yeniden kurulmadı
    expect(kutu.value).toBe('yarım kalan taslak')
    expect(kutu.placeholder).toBe('#ana kanalına mesaj yaz…')
    expect(document.querySelector('.header-name').textContent).toBe('ana')
    expect(document.querySelector('.msg-edit-input')).toBe(duzenKutusu)
    expect(duzenKutusu.value).toBe('düzenlenen metin')
  })

  it('başka pencereden ayrılınca sesteyken "silindi" yerine "Sunucudan ayrıldın." gösterilir', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    fake.rows.servers = []
    olayGonder({ tablo: 'server_members', islem: 'DELETE', server_id: 's1', user_id: 'u1' })
    await bosalt()
    const toastlar = [...document.querySelectorAll('.toast')].map((t) => t.textContent)
    expect(toastlar).toContain('Sunucudan ayrıldın.')
    expect(toastlar).not.toContain('Bu sunucu silindi.')
  })

  it('kanal adı başka istemcide değişince açık sohbetin başlığı da yenilenir', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.rows.channels = kanallar.map((k) => (k.id === 'a' ? { ...k, name: 'ana' } : k))
    olayGonder({ tablo: 'channels', islem: 'UPDATE' })
    await bosalt()
    expect(acikBaslik()).toBe('#ana kanalına mesaj yaz…')
  })
})

describe('okunmamış sayacı (T5)', () => {
  const sayaclar = (liste) => supabase.rpc.mockImplementation(async (ad) => (ad === 'unread_counts' ? { data: liste, error: null } : { data: null, error: null }))
  const satir = (ad) => [...document.querySelectorAll('.channel-item')].find((b) => b.textContent.includes(ad))
  let odak
  beforeEach(() => { odak = true; vi.spyOn(document, 'hasFocus').mockImplementation(() => odak); document.title = 'Voxen' })
  afterEach(() => { vi.restoreAllMocks() })

  it('açılışta sayılar gelir: kanal satırı, sunucu şeridi rozeti ve pencere başlığı', async () => {
    sayaclar([{ channel_id: 'b', server_id: 's1', count: 3 }, { channel_id: 'a', server_id: 's1', count: 0 }])
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(satir('sohbet').classList.contains('unread')).toBe(true)
    expect(satir('sohbet').querySelector('.unread-count').textContent).toBe('3')
    expect(satir('genel').classList.contains('unread')).toBe(false)
    expect(document.querySelector('.server-icon .unread-badge').textContent).toBe('3')
    expect(document.title).toBe('(3) Voxen')
  })

  it('başkasının mesajı artırır; kendi mesajım ve sesli kanal artırmaz', async () => {
    sayaclar([{ channel_id: 'b', server_id: 's1', count: 0 }])
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.allHandlers.INSERT({ new: { id: 1, channel_id: 'b', author_id: 'u2' } })
    fake.allHandlers.INSERT({ new: { id: 2, channel_id: 'b', author_id: 'u1' } })
    expect(satir('sohbet').querySelector('.unread-count').textContent).toBe('1')
    expect(satir('Lobi').querySelector('.unread-count')).toBeNull()
    expect(document.title).toBe('(1) Voxen')
  })

  it('açık kanal odakta ve en alttayken artmaz; odak yokken artar, odağa gelince sıfırlanır', async () => {
    sayaclar([{ channel_id: 'a', server_id: 's1', count: 0 }])
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.allHandlers.INSERT({ new: { id: 5, channel_id: 'a', author_id: 'u2' } })
    expect(satir('genel').querySelector('.unread-count')).toBeNull()
    odak = false
    fake.allHandlers.INSERT({ new: { id: 6, channel_id: 'a', author_id: 'u2' } })
    expect(satir('genel').querySelector('.unread-count').textContent).toBe('1')
    odak = true
    window.dispatchEvent(new Event('focus'))
    expect(satir('genel').querySelector('.unread-count')).toBeNull()
    expect(document.title).toBe('Voxen')
  })

  it('99 üstü "99+" görünür', async () => {
    sayaclar([{ channel_id: 'b', server_id: 's1', count: 100 }])
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(satir('sohbet').querySelector('.unread-count').textContent).toBe('99+')
    expect(document.title).toBe('(99+) Voxen')
  })

  it('stopApp tüm-mesaj aboneliğini kapatır ve başlığı sıfırlar', async () => {
    sayaclar([{ channel_id: 'b', server_id: 's1', count: 2 }])
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(fake.all).toBe(1)
    stopApp()
    await bosalt()
    expect(fake.all).toBe(0)
    expect(document.title).toBe('Voxen')
  })

  it('stopApp açık sohbeti de kapatır: mesaj aboneliği ve "yazıyor" kanalı (aynı sekmede yeniden girişte sızmaz)', async () => {
    sayaclar([])
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(fake.subs).toBe(1)
    expect(fake.typingOpen).toBe(1)
    stopApp()
    await bosalt()
    expect(fake.subs).toBe(0)
    expect(fake.typingOpen).toBe(0)
    // Yeniden giriş: tek sohbet, tek "yazıyor" kanalı
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(fake.subs).toBe(1)
    expect(fake.typingOpen).toBe(1)
  })

  it('en alta kaydırınca açık kanal okundu işaretlenir (odak yokken açılmışsa)', async () => {
    sayaclar([])
    resetReads()
    readTiming.coalesceMs = 0
    fake.rows.messages = [{ id: 7, channel_id: 'a', author_id: 'u2', content: 'selam', created_at: new Date().toISOString() }]
    odak = false // açılışta okundu sayılmasın
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(supabase.rpc.mock.calls.some(([ad]) => ad === 'mark_read')).toBe(false)
    odak = true
    document.querySelector('.message-list').dispatchEvent(new Event('scroll'))
    await bosalt()
    expect(supabase.rpc).toHaveBeenCalledWith('mark_read', { cid: 'a', mid: 7 })
    readTiming.coalesceMs = 1000
  })

  it('çıkışta bekleyen işaretler yazılır ve okuma durumu sıfırlanır (sonraki oturumda aynı mesaj yeniden işaretlenir)', async () => {
    sayaclar([])
    resetReads()
    fake.rows.messages = [{ id: 9, channel_id: 'a', author_id: 'u2', content: 'selam', created_at: new Date().toISOString() }]
    const sayi = () => supabase.rpc.mock.calls.filter(([ad]) => ad === 'mark_read').length
    await startApp(document.querySelector('#app'), profil)
    await bosalt() // açık kanal odakta ve en altta: işaret bekliyor (1 sn birleştirme)
    expect(sayi()).toBe(0)
    stopApp() // hemen yazılır
    await bosalt()
    expect(sayi()).toBe(1)
    // Sıfırlanmadıysa id 9 "zaten gönderildi" sayılıp atlanırdı
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    stopApp()
    await bosalt()
    expect(sayi()).toBe(2)
  })
})

describe('Ana sayfa: arkadaşlar ve DM listesi (sosyal T2)', () => {
  const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
  const veli = { id: 'u3', username: 'veli', color: '#5b7cfa', avatar_url: null }
  const dmSatir = (id, o, ek = {}) => ({
    thread_id: id, other_id: o.id, username: o.username, color: o.color, avatar_url: null,
    created_at: '2026-11-01T00:00:00Z', last_message_at: null, unread: 0, can_send: true, ...ek,
  })
  // ozel: rpc adı -> (arg) => sonuç; diğerleri boş döner
  function rpcKur(ozel = {}) {
    supabase.rpc.mockImplementation(async (ad, arg) => {
      if (ozel[ad]) return ozel[ad](arg)
      if (ad === 'unread_counts' || ad === 'dm_list') return { data: [], error: null }
      return { data: null, error: null }
    })
  }
  const cagriSayisi = (ad) => supabase.rpc.mock.calls.filter(([a]) => a === ad).length
  const evDugmesi = () => document.querySelector('.rail-home')
  const sekme = (ad) => [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.startsWith(ad))

  it('şeritte Ana sayfa; tıklayınca sol sütun + Arkadaşlar sayfası, sohbet ve üye paneli kapanır, yer hatırlanır', async () => {
    rpcKur()
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(fake.subs).toBe(1)
    expect(evDugmesi().classList.contains('selected')).toBe(false)
    evDugmesi().click()
    await bosalt()
    expect(evDugmesi().classList.contains('selected')).toBe(true)
    expect(document.querySelector('.server-icon.selected')).toBeNull()
    expect(document.querySelector('.channel-panel .home-friends')).not.toBeNull()
    expect(document.querySelector('.channel-panel .user-bar')).not.toBeNull() // alttaki çubuk aynen kalır
    expect(document.querySelector('.friends-header')).not.toBeNull()
    expect(document.querySelector('textarea')).toBeNull()
    expect(fake.subs).toBe(0) // kanal sohbeti kapandı
    expect(document.querySelector('.member-panel').classList.contains('sunucusuz')).toBe(true)
    expect(localStorage.getItem('voxen.yer')).toBe('ana')
    // Sunucuya dönünce sohbet geri gelir
    document.querySelector('.server-icon').click()
    await bosalt()
    expect(document.querySelector('textarea').placeholder).toBe('#genel kanalına mesaj yaz…')
    expect(localStorage.getItem('voxen.yer')).toBe('sunucu')
  })

  it('son yer Ana sayfaysa uygulama Ana sayfada açılır', async () => {
    rpcKur()
    localStorage.setItem('voxen.yer', 'ana')
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(evDugmesi().classList.contains('selected')).toBe(true)
    expect(document.querySelector('.friends-header')).not.toBeNull()
    expect(fake.subs).toBe(0)
  })

  it('Ana sayfa rozeti okunmamış DM toplamı; sol sütunda DM satırları son mesaja göre, okunmamış kalın', async () => {
    rpcKur({
      dm_list: () => ({
        data: [
          dmSatir('t1', ali, { unread: 2, last_message_at: '2026-11-10T00:00:00Z' }),
          dmSatir('t2', veli, { unread: 3, last_message_at: '2026-11-12T00:00:00Z' }),
        ],
        error: null,
      }),
    })
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(evDugmesi().querySelector('.unread-badge').textContent).toBe('5')
    evDugmesi().click()
    await bosalt()
    const satirlar = [...document.querySelectorAll('.dm-item')]
    expect(satirlar.map((s) => s.querySelector('.dm-name').textContent)).toEqual(['veli', 'ali'])
    expect(satirlar[0].classList.contains('unread')).toBe(true)
    expect(satirlar[0].querySelector('.unread-count').textContent).toBe('3')
  })

  it('kişi olayı gelince ve pencere odağa gelince listeler yeniden alınır', async () => {
    rpcKur()
    fake.rows.friendships = []
    localStorage.setItem('voxen.yer', 'ana')
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(fake.user).toBe(1) // kişi başına tek abonelik
    sekme('Tümü').click()
    expect(document.querySelector('.friends-empty-text').textContent).toBe('Henüz arkadaşın yok. Kullanıcı adıyla ekleyebilirsin.')
    const once = cagriSayisi('dm_list')
    // Karşı taraf isteğimizi kabul etti: veritabanı "degisti" yayınlar
    fake.rows.friendships = [{ user_a: 'u1', user_b: 'u2', requester: 'u1', status: 'accepted', created_at: '2026-11-13T00:00:00Z', accepted_at: '2026-11-13T00:00:00Z' }]
    fake.rows.profiles = [ali]
    fake.userCb({ payload: { tablo: 'friendships', islem: 'UPDATE' } })
    await bosalt()
    expect(cagriSayisi('dm_list')).toBe(once + 1)
    expect([...document.querySelectorAll('.friend-name')].map((e) => e.textContent)).toEqual(['ali'])
    window.dispatchEvent(new Event('focus'))
    await bosalt()
    expect(cagriSayisi('dm_list')).toBe(once + 2)
    stopApp()
    await bosalt()
    expect(fake.user).toBe(0)
  })

  it('💬 open_dm çağırır ve orta alanda DM sohbeti açılır; DM satırı da açar', async () => {
    rpcKur({
      open_dm: () => ({ data: 't9', error: null }),
      dm_list: () => ({ data: [dmSatir('t1', veli)], error: null }),
    })
    fake.rows.friendships = [{ user_a: 'u1', user_b: 'u2', requester: 'u2', status: 'accepted', created_at: '2026-11-13T00:00:00Z' }]
    fake.rows.profiles = [ali]
    localStorage.setItem('voxen.yer', 'ana')
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    sekme('Tümü').click()
    document.querySelector('.friend-message').click()
    await bosalt()
    expect(supabase.rpc).toHaveBeenCalledWith('open_dm', { other: 'u2' })
    expect(document.querySelector('textarea').placeholder).toBe('@ali kişisine mesaj gönder')
    expect(document.querySelector('.header-host .header-name').textContent).toBe('ali')
    // Sol sütundaki DM satırı (open_dm çağrılmadan konuşma id'siyle açılır)
    const once = cagriSayisi('open_dm')
    document.querySelector('.dm-item').click()
    await bosalt()
    expect(cagriSayisi('open_dm')).toBe(once)
    expect(document.querySelector('.header-host .header-name').textContent).toBe('veli')
    expect(document.querySelector('.dm-item').classList.contains('selected')).toBe(true)
    // Arkadaşlar satırı sayfaya geri döner
    document.querySelector('.home-friends').click()
    await bosalt()
    expect(document.querySelector('.friends-header')).not.toBeNull()
  })

  it('× konuşmayı gizler (hide_dm) ve listeden kalkar; engelde açma hatası toast ile söylenir', async () => {
    let liste = [dmSatir('t1', veli)]
    rpcKur({
      dm_list: () => ({ data: liste, error: null }),
      hide_dm: () => { liste = []; return { data: null, error: null } },
      open_dm: () => ({ data: null, error: { message: 'NOT_ALLOWED' } }),
    })
    fake.rows.friendships = [{ user_a: 'u1', user_b: 'u2', requester: 'u2', status: 'accepted', created_at: '2026-11-13T00:00:00Z' }]
    fake.rows.profiles = [ali]
    localStorage.setItem('voxen.yer', 'ana')
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    document.querySelector('.dm-hide').click()
    await bosalt()
    expect(supabase.rpc).toHaveBeenCalledWith('hide_dm', { tid: 't1' })
    expect(document.querySelector('.dm-item')).toBeNull()
    sekme('Tümü').click()
    document.querySelector('.friend-message').click()
    await bosalt()
    expect(document.querySelector('.toast-hata').textContent).toBe('Bu kişiye mesaj gönderemezsin.')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('Arkadaş ekle kutusu: send_friend_request ve sonuç yazısı', async () => {
    rpcKur({ send_friend_request: ({ username }) => (username === 'ali' ? { data: 'sent', error: null } : { data: null, error: { message: 'NO_USER' } }) })
    localStorage.setItem('voxen.yer', 'ana')
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    document.querySelector('.add-friend-btn').click()
    const kutu = document.querySelector('.add-friend input')
    kutu.value = 'ali'
    kutu.dispatchEvent(new Event('input'))
    document.querySelector('.add-friend button[type="submit"]').click()
    await bosalt()
    expect(document.querySelector('.add-friend-result').textContent).toBe('İstek gönderildi.')
    kutu.value = 'yok'
    kutu.dispatchEvent(new Event('input'))
    document.querySelector('.add-friend button[type="submit"]').click()
    await bosalt()
    expect(document.querySelector('.add-friend-result').textContent).toBe('Böyle bir kullanıcı yok.')
  })

  it('üye listesinden açılan kartta (arkadaş değil) Mesaj gönder ve Arkadaş ekle; Mesaj gönder DM açar', async () => {
    rpcKur({ open_dm: () => ({ data: 't5', error: null }) })
    fake.rows.server_members = [{ user_id: 'u1' }, { user_id: 'u2' }]
    fake.rows.profiles = [{ id: 'u1', username: 'berk', color: '#5b7cfa' }, ali]
    fake.rows.friendships = []
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    document.querySelector('.member-panel [data-profile-opener="u2"]').click()
    const yazilar = [...document.querySelectorAll('.profile-card-social button')].map((b) => b.textContent)
    expect(yazilar).toEqual(['Mesaj gönder', 'Arkadaş ekle'])
    document.querySelector('.profile-card-message').click()
    await bosalt()
    expect(supabase.rpc).toHaveBeenCalledWith('open_dm', { other: 'u2' })
    expect(evDugmesi().classList.contains('selected')).toBe(true)
    expect(document.querySelector('textarea').placeholder).toBe('@ali kişisine mesaj gönder')
  })

  it('kendi kartımızda arkadaşlık/mesaj düğmesi yok', async () => {
    rpcKur()
    fake.rows.server_members = [{ user_id: 'u1' }]
    fake.rows.profiles = [{ id: 'u1', username: 'berk', color: '#5b7cfa' }]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    document.querySelector('.member-panel [data-profile-opener="u1"]').click()
    expect(document.querySelector('.profile-card')).not.toBeNull()
    expect(document.querySelector('.profile-card-social')).toBeNull()
  })
})

describe('özel mesaj sohbeti ve canlı DM okunmamış (sosyal T3)', () => {
  const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
  const veli = { id: 'u3', username: 'veli', color: '#5b7cfa', avatar_url: null }
  const dmSatir = (id, o, ek = {}) => ({
    thread_id: id, other_id: o.id, username: o.username, color: o.color, avatar_url: null,
    created_at: '2026-11-01T00:00:00Z', last_message_at: null, unread: 0, can_send: true, ...ek,
  })
  const dmMesaj = (id, tid, author, ek = {}) => ({
    id, thread_id: tid, author_id: author, content: `m${id}`, edited_at: null, deleted_at: null,
    created_at: new Date(Date.UTC(2026, 10, 13, 10, 0) + id * 60000).toISOString(), ...ek,
  })
  let liste
  function rpcKur(ozel = {}) {
    supabase.rpc.mockImplementation(async (ad, arg) => {
      if (ozel[ad]) return ozel[ad](arg)
      if (ad === 'dm_list') return { data: liste, error: null }
      if (ad === 'unread_counts') return { data: [], error: null }
      return { data: null, error: null }
    })
  }
  const cagriSayisi = (ad) => supabase.rpc.mock.calls.filter(([a]) => a === ad).length
  const evRozeti = () => document.querySelector('.rail-home .unread-badge')
  const dmSatiri = (ad) => [...document.querySelectorAll('.dm-item')].find((b) => b.querySelector('.dm-name').textContent === ad)
  let odak
  beforeEach(() => {
    odak = true
    vi.spyOn(document, 'hasFocus').mockImplementation(() => odak)
    document.title = 'Voxen'
    liste = [dmSatir('t1', ali), dmSatir('t2', veli)]
    localStorage.setItem('voxen.yer', 'ana')
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('DM satırı sohbeti açar: başlıkta avatar + durum noktası + ad, "@ad kişisine mesaj gönder", sağda profil kartı', async () => {
    rpcKur()
    fake.rows.dm_messages = [dmMesaj(1, 't1', 'u2'), dmMesaj(2, 't1', 'u1')]
    fake.rows.profiles = [ali]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    dmSatiri('ali').click()
    await bosalt()
    const baslik = document.querySelector('.header-host .main-header')
    expect(baslik.querySelector('.header-name').textContent).toBe('ali')
    expect(baslik.querySelector('.header-dm-avatar .status-dot').dataset.status).toBe('offline')
    expect(baslik.querySelector('.header-hash')).toBeNull()
    expect(baslik.querySelector('.members-toggle')).toBeNull() // DM'de Üyeler düğmesi yok
    expect(document.querySelector('textarea').placeholder).toBe('@ali kişisine mesaj gönder')
    expect([...document.querySelectorAll('.msg-text')].map((e) => e.textContent)).toEqual(['m1', 'm2'])
    expect(fake.subs).toBe(1) // açık DM'in tek aboneliği
    const panel = document.querySelector('.member-panel')
    expect(panel.classList.contains('dm-profil')).toBe(true)
    expect(panel.classList.contains('sunucusuz')).toBe(false)
    expect(panel.hidden).toBe(false)
    expect(panel.querySelector('.dm-profile-card .profile-card-name').textContent).toBe('ali')
    expect(panel.querySelector('.profile-card-message')).toBeNull() // zaten bu konuşmadayız
    // Karşı taraf çevrimiçi olunca başlıktaki nokta güncellenir
    fake.presenceState = { u2: [{ user_id: 'u2', status: 'online', client_id: 'x' }] }
    fake.syncCb?.()
    await bosalt()
    expect(document.querySelector('.header-host .header-dm-avatar .status-dot').dataset.status).toBe('online')
    // Arkadaşlar sayfasına dönünce sohbet kapanır, panel gizlenir
    document.querySelector('.home-friends').click()
    await bosalt()
    expect(fake.subs).toBe(0)
    expect(panel.classList.contains('dm-profil')).toBe(false)
    expect(panel.classList.contains('sunucusuz')).toBe(true)
  })

  it('varlık olayı: DM başlığı ve profil kartı yalnız karşı tarafın durumu değişince yeniden çizilir', async () => {
    rpcKur()
    fake.rows.dm_messages = [dmMesaj(1, 't1', 'u2')]
    fake.rows.profiles = [ali]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    dmSatiri('ali').click()
    await bosalt()
    const avatar = () => document.querySelector('.header-host .header-dm-avatar')
    const kart = () => document.querySelector('.member-panel .dm-profile-card')
    const ilkAvatar = avatar()
    const ilkKart = kart()
    // Başka biri çevrimiçi oldu: ikisi de yerinde kalır
    fake.presenceState = { u3: [{ user_id: 'u3', status: 'online', client_id: 'y' }] }
    fake.syncCb?.()
    await bosalt()
    fake.syncCb?.() // aynı durum yeniden geldi
    await bosalt()
    expect(avatar()).toBe(ilkAvatar)
    expect(kart()).toBe(ilkKart)
    // ali çevrimiçi oldu: ikisi de yenilenir
    fake.presenceState = { ...fake.presenceState, u2: [{ user_id: 'u2', status: 'online', client_id: 'x' }] }
    fake.syncCb?.()
    await bosalt()
    expect(avatar()).not.toBe(ilkAvatar)
    expect(avatar().querySelector('.status-dot').dataset.status).toBe('online')
    expect(kart()).not.toBe(ilkKart)
    const ikinciKart = kart()
    fake.syncCb?.()
    await bosalt()
    expect(kart()).toBe(ikinciKart)
  })

  it('DM\'den sunucuya geçince sağ panelde eski profil kartı kalmaz, üye listesi gelir', async () => {
    rpcKur()
    fake.rows.dm_messages = [dmMesaj(1, 't1', 'u2')]
    fake.rows.profiles = [ali]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    dmSatiri('ali').click()
    await bosalt()
    const panel = document.querySelector('.member-panel')
    expect(panel.querySelector('.dm-profile-card')).not.toBeNull()
    // Üye listesi yüklenirken (bekletilir) eski kart görünmemeli
    let ac
    fake.membersGate = new Promise((r) => { ac = r })
    document.querySelector('.server-icon').click()
    await bosalt()
    expect(panel.classList.contains('dm-profil')).toBe(false)
    expect(panel.querySelector('.dm-profile-card')).toBeNull()
    ac()
    fake.membersGate = null
    await bosalt()
    expect(panel.querySelector('.dm-profile-card')).toBeNull()
  })

  it('arkadaş listesinde ⋯ menüsü açıkken varlık olayı menüyü ve odağı bozmaz', async () => {
    rpcKur()
    fake.rows.friendships = [{ user_a: 'u1', user_b: 'u2', requester: 'u2', status: 'accepted', created_at: '2026-11-13T00:00:00Z' }]
    fake.rows.profiles = [ali]
    localStorage.setItem('voxen.yer', 'ana')
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    ;[...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.startsWith('Tümü')).click()
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) // önceki testlerden kalan basılı fare durumu
    const diger = document.querySelector('.friend-more')
    diger.click()
    const menu = document.querySelector('.popup-menu')
    const odakli = document.activeElement
    expect(menu).not.toBeNull()
    fake.presenceState = { u2: [{ user_id: 'u2', status: 'online', client_id: 'x' }] }
    fake.syncCb?.()
    await bosalt()
    expect(document.querySelector('.friend-more')).toBe(diger) // liste baştan çizilmedi
    expect(document.querySelector('.popup-menu')).toBe(menu)
    expect(document.activeElement).toBe(odakli)
    // Menü kapanınca bekleyen çizim yapılır: yeni durum görünür
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await bosalt()
    expect(document.querySelector('.popup-menu')).toBeNull()
    expect(document.querySelector('.friend-row .status-dot').dataset.status).toBe('online')
  })

  it('engelli konuşma (can_send=false): eski mesajlar görünür, kutu yerine "Bu kişiye mesaj gönderemezsin."', async () => {
    liste = [dmSatir('t1', ali, { can_send: false })]
    rpcKur()
    fake.rows.dm_messages = [dmMesaj(1, 't1', 'u2')]
    fake.rows.profiles = [ali]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    dmSatiri('ali').click()
    await bosalt()
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.querySelector('.composer-blocked').textContent).toBe('Bu kişiye mesaj gönderemezsin.')
    expect(document.querySelector('.msg-text').textContent).toBe('m1')
    expect(cagriSayisi('open_dm')).toBe(0) // satırdan açılır, open_dm çağrılmaz
    // Engel kalkınca (liste yeniden alınınca) kutu geri gelir
    liste = [dmSatir('t1', ali)]
    window.dispatchEvent(new Event('focus'))
    await bosalt()
    expect(document.querySelector('textarea').placeholder).toBe('@ali kişisine mesaj gönder')
  })

  it('tek DM aboneliği: başkasının mesajı satır sayısını, Ana sayfa rozetini ve başlığı artırır; kendi mesajım artırmaz', async () => {
    localStorage.setItem('voxen.yer', 'sunucu')
    rpcKur({ unread_counts: () => ({ data: [{ channel_id: 'b', server_id: 's1', count: 0 }], error: null }) })
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(fake.dmAll).toBe(1)
    expect(evRozeti()).toBeNull()
    fake.dmAllHandlers.INSERT({ new: dmMesaj(10, 't2', 'u3') })
    fake.dmAllHandlers.INSERT({ new: dmMesaj(11, 't2', 'u3') })
    fake.dmAllHandlers.INSERT({ new: dmMesaj(12, 't1', 'u1') }) // kendi mesajım (başka pencereden)
    expect(evRozeti().textContent).toBe('2')
    expect(document.title).toBe('(2) Voxen')
    // Kanal okunmamışı da başlığa eklenir
    fake.allHandlers.INSERT({ new: { id: 1, channel_id: 'b', author_id: 'u2' } })
    expect(document.title).toBe('(3) Voxen')
    document.querySelector('.rail-home').click()
    await bosalt()
    expect(dmSatiri('veli').querySelector('.unread-count').textContent).toBe('2')
    expect(dmSatiri('ali').querySelector('.unread-count')).toBeNull()
    // En son mesaj t1'de (kendi mesajım): liste son mesaja göre sıralı
    expect([...document.querySelectorAll('.dm-name')].map((e) => e.textContent)).toEqual(['ali', 'veli'])
    stopApp()
    await bosalt()
    expect(fake.dmAll).toBe(0)
  })

  it('arama kaydı satırı (kind call) metin satırı gibi okunmamış sayılır', async () => {
    localStorage.setItem('voxen.yer', 'sunucu')
    rpcKur({ unread_counts: () => ({ data: [{ channel_id: 'b', server_id: 's1', count: 0 }], error: null }) })
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.dmAllHandlers.INSERT({ new: dmMesaj(30, 't2', 'u3', { kind: 'call', content: '📞 Cevapsız arama' }) })
    expect(evRozeti().textContent).toBe('1')
    fake.dmAllHandlers.INSERT({ new: dmMesaj(31, 't2', 'u3', { kind: 'text' }) })
    expect(evRozeti().textContent).toBe('2')
  })

  it('listede olmayan konuşmadan mesaj ve yeniden bağlanma: liste dm_list ile yeniden alınır', async () => {
    rpcKur()
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    const once = cagriSayisi('dm_list')
    fake.dmAllHandlers.INSERT({ new: dmMesaj(20, 't9', 'u4') })
    await bosalt()
    expect(cagriSayisi('dm_list')).toBe(once + 1)
    // Kopukken gelenler sayılmadı: sunucudaki doğru sayılar alınır
    liste = [dmSatir('t1', ali, { unread: 4 }), dmSatir('t2', veli)]
    fake.dmAllSub('SUBSCRIBED')
    await bosalt()
    expect(cagriSayisi('dm_list')).toBe(once + 2)
    expect(evRozeti().textContent).toBe('4')
    expect(document.title).toBe('(4) Voxen')
  })

  it('açık ve en alttaki DM okundu sayılır (mark_dm_read); pencere odakta değilken gelen mesaj artırır', async () => {
    liste = [dmSatir('t1', ali, { unread: 2 })]
    rpcKur()
    fake.rows.dm_messages = [dmMesaj(1, 't1', 'u2'), dmMesaj(2, 't1', 'u2')]
    fake.rows.profiles = [ali]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(evRozeti().textContent).toBe('2')
    dmSatiri('ali').click()
    await bosalt()
    expect(evRozeti()).toBeNull() // açılınca (odakta, en altta) sayı sıfırlanır
    expect(document.title).toBe('Voxen')
    // Açık DM'e mesaj: okunuyor, artmaz
    fake.dmAllHandlers.INSERT({ new: dmMesaj(3, 't1', 'u2') })
    expect(evRozeti()).toBeNull()
    // Pencere odakta değil: artar; odağa gelince yeniden sıfırlanır
    odak = false
    fake.dmAllHandlers.INSERT({ new: dmMesaj(4, 't1', 'u2') })
    fake.dmChatInsert?.({ new: dmMesaj(4, 't1', 'u2') })
    await bosalt()
    expect(evRozeti().textContent).toBe('1')
    odak = true
    window.dispatchEvent(new Event('focus'))
    await bosalt()
    expect(evRozeti()).toBeNull()
    // Okundu işareti birleştirilerek yazılır; çıkışta bekleyen hemen gider
    stopApp()
    await bosalt()
    const isaretler = supabase.rpc.mock.calls.filter(([a]) => a === 'mark_dm_read').map(([, arg]) => arg)
    expect(isaretler.at(-1)).toEqual({ tid: 't1', mid: 4 })
  })
})

describe('masaüstü bildirimleri ve sessize alma (sosyal T5)', () => {
  const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
  const veli = { id: 'u3', username: 'veli', color: '#5b7cfa', avatar_url: null }
  const dmSatir = (id, o) => ({
    thread_id: id, other_id: o.id, username: o.username, color: o.color, avatar_url: null,
    created_at: '2026-11-01T00:00:00Z', last_message_at: null, unread: 0, can_send: true,
  })
  const dmMesaj = (id, tid, author, content = `m${id}`) => ({
    id, thread_id: tid, author_id: author, content, edited_at: null, deleted_at: null,
    created_at: new Date(Date.UTC(2026, 10, 13, 10, 0) + id * 60000).toISOString(),
  })
  let liste
  let odak
  let olusan
  beforeEach(() => {
    odak = false
    vi.spyOn(document, 'hasFocus').mockImplementation(() => odak)
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    liste = [dmSatir('t1', ali), dmSatir('t2', veli)]
    supabase.rpc.mockImplementation(async (ad) => {
      if (ad === 'dm_list') return { data: liste, error: null }
      if (ad === 'unread_counts') return { data: [{ channel_id: 'a', server_id: 's1', count: 0 }, { channel_id: 'b', server_id: 's1', count: 0 }], error: null }
      return { data: null, error: null }
    })
    fake.rows.profiles = [ali, veli]
    fake.rows.server_members = [{ user_id: 'u1' }, { user_id: 'u2' }]
    olusan = []
    class SahteBildirim {
      constructor(baslik, secenek) { this.baslik = baslik; this.secenek = secenek; this.close = () => {}; olusan.push(this) }
    }
    SahteBildirim.permission = 'granted'
    SahteBildirim.requestPermission = vi.fn(async () => 'granted')
    vi.stubGlobal('Notification', SahteBildirim)
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('DM: pencere arkadayken bildirim "Ad" + metin; kendi mesajım ve odakta açık DM bildirmez; tıklayınca DM açılır', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.dmAllHandlers.INSERT({ new: dmMesaj(10, 't2', 'u3', 'selam berk') })
    fake.dmAllHandlers.INSERT({ new: dmMesaj(11, 't1', 'u1') }) // kendi mesajım
    expect(olusan.map((n) => [n.baslik, n.secenek.body])).toEqual([['veli', 'selam berk']])
    olusan[0].onclick()
    await bosalt()
    expect(document.querySelector('textarea').placeholder).toBe('@veli kişisine mesaj gönder')
    // Bu DM açık ve pencere odakta: bildirim yok; başka DM'den gelen bildirilir
    odak = true
    fake.dmAllHandlers.INSERT({ new: dmMesaj(12, 't2', 'u3') })
    fake.dmAllHandlers.INSERT({ new: dmMesaj(13, 't1', 'u2') })
    expect(olusan.map((n) => n.baslik)).toEqual(['veli', 'ali'])
  })

  it('Rahatsız etmeyin ya da ayar kapalıyken bildirim gelmez', async () => {
    localStorage.setItem('voxen.presence', JSON.stringify({ dnd: true }))
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.dmAllHandlers.INSERT({ new: dmMesaj(10, 't2', 'u3') })
    expect(olusan).toHaveLength(0)
    localStorage.setItem('voxen.presence', JSON.stringify({ dnd: false }))
    localStorage.setItem('voxen.bildirimler', JSON.stringify({ masaustu: false, ses: true }))
    fake.dmAllHandlers.INSERT({ new: dmMesaj(11, 't2', 'u3') })
    expect(olusan).toHaveLength(0)
  })

  it('listede olmayan konuşmadan ilk DM: liste yenilenince bildirilir', async () => {
    liste = [dmSatir('t1', ali)]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    liste = [dmSatir('t1', ali), dmSatir('t2', veli)]
    fake.dmAllHandlers.INSERT({ new: dmMesaj(10, 't2', 'u3') })
    await bosalt()
    expect(olusan.map((n) => n.baslik)).toEqual(['veli'])
  })

  it('bildirime tıklanınca DM listede yoksa liste tazelenip bir kez daha denenir', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    fake.dmAllHandlers.INSERT({ new: dmMesaj(10, 't2', 'u3', 'selam') })
    expect(olusan.map((n) => n.baslik)).toEqual(['veli'])
    // Konuşma bu arada yerel listeden düştü (ör. gizlendi), sunucuda yine var
    liste = [dmSatir('t1', ali)]
    window.dispatchEvent(new Event('focus'))
    await bosalt()
    expect([...document.querySelectorAll('.dm-item .dm-name')].map((e) => e.textContent)).not.toContain('veli')
    liste = [dmSatir('t1', ali), dmSatir('t2', veli)]
    olusan[0].onclick()
    await bosalt()
    expect(document.querySelector('textarea').placeholder).toBe('@veli kişisine mesaj gönder')
  })

  it('@bahsetme: başlık "Ad (#kanal, Sunucu)"; anmayan mesaj bildirmez; tıklayınca o kanal açılır', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(document.querySelector('textarea').placeholder).toBe('#genel kanalına mesaj yaz…')
    fake.allHandlers.INSERT({ new: { id: 1, channel_id: 'b', author_id: 'u2', content: 'selam herkese' } })
    fake.allHandlers.INSERT({ new: { id: 2, channel_id: 'b', author_id: 'u2', content: '@berk bakar mısın' } })
    fake.allHandlers.INSERT({ new: { id: 3, channel_id: 'b', author_id: 'u2', content: '@berkcan değil' } })
    await bosalt()
    expect(olusan.map((n) => [n.baslik, n.secenek.body])).toEqual([['ali (#sohbet, S)', '@berk bakar mısın']])
    olusan[0].onclick()
    await bosalt()
    expect(document.querySelector('textarea').placeholder).toBe('#sohbet kanalına mesaj yaz…')
  })

  it('sessize alınan sunucu: bahsetme bildirmez, simge soluk, rozet yine çıkar, menüde "Sessizden çıkar"', async () => {
    fake.rows.server_mutes = [{ server_id: 's1' }]
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(document.querySelector('.server-icon[data-odak="sunucu-s1"]').classList.contains('muted')).toBe(true)
    fake.allHandlers.INSERT({ new: { id: 2, channel_id: 'b', author_id: 'u2', content: '@berk bak' } })
    await bosalt()
    expect(olusan).toHaveLength(0)
    expect(document.querySelector('.server-icon[data-odak="sunucu-s1"] .unread-badge').textContent).toContain('1')
    fake.dmAllHandlers.INSERT({ new: dmMesaj(10, 't2', 'u3') }) // DM'ler sessize alınamaz
    expect(olusan.map((n) => n.baslik)).toEqual(['veli'])
    document.querySelector('.server-name-btn').click()
    expect([...document.querySelectorAll('.popup-menu [role=menuitem]')].map((b) => b.textContent)).toContain('Sessizden çıkar')
  })

  it('menüden "Sunucuyu sessize al": server_mutes satırı eklenir, simge soluklaşır', async () => {
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(document.querySelector('.server-icon[data-odak="sunucu-s1"]').classList.contains('muted')).toBe(false)
    document.querySelector('.server-name-btn').click()
    ;[...document.querySelectorAll('.popup-menu [role=menuitem]')].find((b) => b.textContent === 'Sunucuyu sessize al').click()
    await bosalt()
    expect(fake.inserts).toContainEqual(['server_mutes', { server_id: 's1' }])
    expect(document.querySelector('.server-icon[data-odak="sunucu-s1"]').classList.contains('muted')).toBe(true)
  })

  it('ilk DM açılınca tarayıcıda bildirim izni bir kez istenir', async () => {
    Notification.permission = 'default'
    localStorage.setItem('voxen.yer', 'ana')
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
    expect(Notification.requestPermission).not.toHaveBeenCalled()
    ;[...document.querySelectorAll('.dm-item')].find((b) => b.querySelector('.dm-name').textContent === 'ali').click()
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1)
  })
})

describe('DM araması: 📞, arama paneli ve "arama" olayları (arama T3)', () => {
  const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
  const dmSatir = (id, o, ek = {}) => ({
    thread_id: id, other_id: o.id, username: o.username, color: o.color, avatar_url: null,
    created_at: '2026-11-01T00:00:00Z', last_message_at: null, unread: 0, can_send: true, ...ek,
  })
  let liste
  let baslatma
  function rpcKur() {
    supabase.rpc.mockImplementation(async (ad, arg) => {
      if (ad === 'dm_list') return { data: liste, error: null }
      if (ad === 'unread_counts') return { data: [], error: null }
      if (ad === 'start_dm_call') return baslatma(arg)
      if (ad === 'ping_dm_call') return { data: true, error: null }
      return { data: null, error: null }
    })
  }
  const cagrilar = (ad) => supabase.rpc.mock.calls.filter(([a]) => a === ad).map(([, x]) => x)
  const dmSatiri = (ad) => [...document.querySelectorAll('.dm-item')].find((b) => b.querySelector('.dm-name').textContent === ad)
  const araDugmesi = () => document.querySelector('.header-host .call-start')
  const panel = () => document.querySelector('.call-host .call-panel')
  const toastlar = () => [...document.querySelectorAll('.toast')].map((t) => t.textContent)
  const aramaOlayi = (yuk) => fake.userHandlers.arama({ payload: { thread_id: 't1', caller: 'u1', reason: null, ...yuk } })
  const dmSesKonulari = () => fake.channel.mock.calls.map(([ad]) => ad).filter((ad) => ad.startsWith('dm-voice:'))

  beforeEach(() => {
    vi.spyOn(document, 'hasFocus').mockImplementation(() => true)
    liste = [dmSatir('t1', ali)]
    baslatma = () => ({ data: { id: 'c1', status: 'ringing' }, error: null })
    fake.joinHatasi = false
    fake.userHandlers = {}
    fake.channel.mockClear()
    localStorage.setItem('voxen.yer', 'ana')
  })
  afterEach(() => { vi.restoreAllMocks() })

  async function uygulamayiAc() {
    rpcKur()
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
  }
  async function dmAc() {
    await uygulamayiAc()
    dmSatiri('ali').click()
    await bosalt()
  }

  it('DM başlığında 📞 "Sesli arama başlat"; basınca "Aranıyor…" paneli; olaylarla konuşmaya geçer ve kapanır', async () => {
    await dmAc()
    expect(araDugmesi().getAttribute('aria-label')).toBe('Sesli arama başlat')
    expect(panel()).toBeNull()
    araDugmesi().click()
    await bosalt()
    expect(cagrilar('start_dm_call')).toEqual([{ tid: 't1' }])
    expect(panel().classList.contains('araniyor')).toBe(true)
    expect(panel().querySelector('.call-status').textContent).toBe('Aranıyor…')
    // Panel başlığın altında, sohbetin üstünde (görüntü bölmesinin yerinde)
    const sira = [...document.querySelector('.call-host').parentElement.children].map((e) => e.className)
    expect(sira.indexOf('call-host')).toBe(sira.indexOf('header-host') + 1)
    expect(sira.indexOf('chat-host')).toBeGreaterThan(sira.indexOf('call-host'))
    expect(araDugmesi().getAttribute('aria-label')).toBe('Aramadasın')
    expect(dmSesKonulari()).toEqual([]) // cevap gelmeden sese girilmez

    aramaOlayi({ call_id: 'c1', status: 'active' })
    await bosalt()
    expect(dmSesKonulari()).toEqual(['dm-voice:c1'])
    expect(panel().classList.contains('konusma')).toBe(true)
    expect([...panel().querySelectorAll('.call-avatar-wrap')].map((a) => a.dataset.id)).toEqual(['u1', 'u2'])
    expect(panel().querySelector('.call-timer').textContent).toMatch(/^00:0\d$/)

    // Karşı taraf kapattı: panel kapanır, 📞 yeniden etkin
    aramaOlayi({ call_id: 'c1', status: 'ended', reason: 'hangup' })
    await bosalt()
    expect(panel()).toBeNull()
    expect(araDugmesi().getAttribute('aria-label')).toBe('Sesli arama başlat')
    expect(cagrilar('end_dm_call')).toEqual([]) // sunucu zaten bitirdi
  })

  it('İptal: end_dm_call cancel; konuşmada Kapat: hangup', async () => {
    await dmAc()
    araDugmesi().click()
    await bosalt()
    panel().querySelector('.call-cancel').click()
    await bosalt()
    expect(cagrilar('end_dm_call')).toEqual([{ id: 'c1', reason: 'cancel' }])
    expect(panel()).toBeNull()

    baslatma = () => ({ data: { id: 'c2', status: 'active' }, error: null }) // karşılıklı arama
    araDugmesi().click()
    await bosalt()
    expect(panel().classList.contains('konusma')).toBe(true)
    panel().querySelector('[data-ad="Kapat"]').click()
    await bosalt()
    expect(cagrilar('end_dm_call').at(-1)).toEqual({ id: 'c2', reason: 'hangup' })
    expect(panel()).toBeNull()
  })

  it('reddedilince "ali aramayı reddetti."; meşgulse "ali şu an başka bir aramada."', async () => {
    await dmAc()
    araDugmesi().click()
    await bosalt()
    aramaOlayi({ call_id: 'c1', status: 'ended', reason: 'decline' })
    await bosalt()
    expect(panel()).toBeNull()
    expect(toastlar()).toContain('ali aramayı reddetti.')
    baslatma = () => ({ data: null, error: { message: 'BUSY' } })
    araDugmesi().click()
    await bosalt()
    expect(toastlar()).toContain('ali şu an başka bir aramada.')
    expect(panel()).toBeNull()
  })

  it('başka bir DM\'de 📞: "Sesli arama başlat" ama pasif, baloncukta "Zaten bir aramadasın."', async () => {
    const veli = { id: 'u3', username: 'veli', color: '#5b7cfa', avatar_url: null }
    liste = [dmSatir('t1', ali), dmSatir('t2', veli)]
    baslatma = () => ({ data: { id: 'c6', status: 'active' }, error: null })
    await dmAc()
    araDugmesi().click()
    await bosalt()
    expect(araDugmesi().getAttribute('aria-label')).toBe('Aramadasın')
    dmSatiri('veli').click()
    await bosalt()
    expect(araDugmesi().getAttribute('aria-label')).toBe('Sesli arama başlat')
    expect(araDugmesi().dataset.tip).toBe('Zaten bir aramadasın.')
    expect(araDugmesi().getAttribute('aria-disabled')).toBe('true')
    araDugmesi().click()
    await bosalt()
    expect(cagrilar('start_dm_call')).toHaveLength(1)
  })

  it('user: kanalı yeniden bağlanınca "Aranıyor…" aramasının durumu okunur; active ise konuşmaya geçilir', async () => {
    await dmAc()
    araDugmesi().click()
    await bosalt()
    expect(panel().classList.contains('araniyor')).toBe(true)
    fake.rows.dm_calls = [{ status: 'active', end_reason: null }] // "active" olayı kopuklukta kaçtı
    fake.userHandlers.degisti({ payload: { yeniden: true } })
    await bosalt()
    expect(panel().classList.contains('konusma')).toBe(true)
    expect(dmSesKonulari()).toEqual(['dm-voice:c1'])
    expect(cagrilar('end_dm_call')).toEqual([])
  })

  it('user: kanalı yeniden bağlanınca konuşmadaki aramanın durumu da okunur; ended ise normal bitiş ("bağlantı koptu" yok)', async () => {
    baslatma = () => ({ data: { id: 'c1', status: 'active' }, error: null })
    await dmAc()
    araDugmesi().click()
    await bosalt()
    expect(panel().classList.contains('konusma')).toBe(true)
    const leave = vi.spyOn(fake.oturum, 'leave')
    // Hâlâ sürüyorsa bir şey olmaz
    fake.rows.dm_calls = [{ status: 'active', end_reason: null }]
    fake.userHandlers.degisti({ payload: { yeniden: true } })
    await bosalt()
    expect(panel().classList.contains('konusma')).toBe(true)
    // Kopukken karşı taraf kapattı ("ended" olayı kaçtı)
    fake.rows.dm_calls = [{ status: 'ended', end_reason: 'hangup' }]
    fake.userHandlers.degisti({ payload: { yeniden: true } })
    await bosalt()
    expect(panel()).toBeNull()
    expect(leave).toHaveBeenCalledTimes(1) // oturum kapanır (bitiş biplemesini oturum çalar)
    expect(toastlar()).not.toContain('Arama bağlantısı koptu.')
    expect(cagrilar('end_dm_call')).toEqual([]) // sunucu zaten bitirdi
    expect(araDugmesi().getAttribute('aria-label')).toBe('Sesli arama başlat')
  })

  it('kutu kapalıyken (can_send=false) 📞 pasif', async () => {
    liste = [dmSatir('t1', ali, { can_send: false })]
    await dmAc()
    expect(araDugmesi().getAttribute('aria-disabled')).toBe('true')
    araDugmesi().click()
    await bosalt()
    expect(cagrilar('start_dm_call')).toEqual([])
  })

  it('sesli kanaldayken arayınca önce kanaldan çıkılır ("Sesli kanaldan ayrıldın.")', async () => {
    localStorage.setItem('voxen.yer', 'sunucu')
    await uygulamayiAc()
    kanalaTikla('Lobi')
    await bosalt()
    expect(fake.voice).toBe(1)
    document.querySelector('.rail-home').click()
    await bosalt()
    dmSatiri('ali').click()
    await bosalt()
    araDugmesi().click()
    await bosalt()
    expect(fake.voice).toBe(0)
    expect(toastlar()).toContain('Sesli kanaldan ayrıldın.')
    expect(panel().classList.contains('araniyor')).toBe(true)
  })

  it('ses oturumuna katılma başarısızsa arama lost ile biter: "Arama bağlantısı koptu."', async () => {
    fake.joinHatasi = true
    baslatma = () => ({ data: { id: 'c4', status: 'active' }, error: null })
    await dmAc()
    araDugmesi().click()
    await bosalt()
    expect(cagrilar('end_dm_call')).toContainEqual({ id: 'c4', reason: 'lost' })
    expect(toastlar()).toContain('Arama bağlantısı koptu.')
    expect(panel()).toBeNull()
  })

  it('Arkadaşlar sayfasına geçince panel gizlenir, arama sürer; DM açılınca yine görünür', async () => {
    baslatma = () => ({ data: { id: 'c5', status: 'active' }, error: null })
    await dmAc()
    araDugmesi().click()
    await bosalt()
    document.querySelector('.rail-home').click() // Ana sayfa: Arkadaşlar sayfası
    await bosalt()
    expect(panel()).toBeNull()
    expect(dmSesKonulari()).toEqual(['dm-voice:c5'])
    dmSatiri('ali').click()
    await bosalt()
    expect(panel().classList.contains('konusma')).toBe(true)
    expect(cagrilar('end_dm_call')).toEqual([])
  })

  it('aramadayken sesli kanala girilince arama biter (hangup) ve panel kapanır', async () => {
    baslatma = () => ({ data: { id: 'c3', status: 'active' }, error: null })
    await dmAc()
    araDugmesi().click()
    await bosalt()
    expect(panel().classList.contains('konusma')).toBe(true)
    // Sunucuya geç ve sesli kanala gir
    const sunucu = [...document.querySelectorAll('.server-icon')].find((b) => !b.classList.contains('rail-home') && b.dataset.id === 's1')
      ?? [...document.querySelectorAll('.server-icon')].find((b) => b.getAttribute('aria-label') === 'S')
    sunucu.click()
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    expect(cagrilar('end_dm_call')).toContainEqual({ id: 'c3', reason: 'hangup' })
    expect(fake.voice).toBe(1)
  })
})

describe('gelen DM araması: kart, zil, bildirim (arama T4)', () => {
  const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
  const veli = { id: 'u3', username: 'veli', color: '#5b7cfa', avatar_url: null }
  const dmSatir = (id, o, ek = {}) => ({
    thread_id: id, other_id: o.id, username: o.username, color: o.color, avatar_url: null,
    created_at: '2026-11-01T00:00:00Z', last_message_at: null, unread: 0, can_send: true, ...ek,
  })
  let liste
  let cevap
  let baslatma
  let odak
  let olusan
  function rpcKur() {
    supabase.rpc.mockImplementation(async (ad, arg) => {
      if (ad === 'dm_list') return { data: liste, error: null }
      if (ad === 'unread_counts') return { data: [], error: null }
      if (ad === 'answer_dm_call') return cevap(arg)
      if (ad === 'start_dm_call') return baslatma(arg)
      if (ad === 'ping_dm_call') return { data: true, error: null }
      return { data: null, error: null }
    })
  }
  const cagrilar = (ad) => supabase.rpc.mock.calls.filter(([a]) => a === ad).map(([, x]) => x)
  const kart = () => document.querySelector('.toast-stack .incoming-call')
  const kartBasligi = () => kart()?.querySelector('.incoming-call-title').textContent
  const panel = () => document.querySelector('.call-host .call-panel')
  const toastlar = () => [...document.querySelectorAll('.toast')].map((t) => t.textContent)
  const dmSesKonulari = () => fake.channel.mock.calls.map(([ad]) => ad).filter((ad) => ad.startsWith('dm-voice:'))
  const zil = () => fake.donguler.filter((d) => d.ad === 'zil')
  const olay = (yuk) => fake.userHandlers.arama({ payload: { thread_id: 't1', caller: 'u2', reason: null, ...yuk } })
  const dmSatiri = (ad) => [...document.querySelectorAll('.dm-item')].find((b) => b.querySelector('.dm-name').textContent === ad)
  const araDugmesi = () => document.querySelector('.header-host .call-start')

  beforeEach(() => {
    odak = true
    vi.spyOn(document, 'hasFocus').mockImplementation(() => odak)
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    liste = [dmSatir('t1', ali)]
    cevap = ({ id }) => ({ data: { id, status: 'active' }, error: null })
    baslatma = () => ({ data: { id: 'c1', status: 'active' }, error: null })
    fake.joinHatasi = false
    fake.userHandlers = {}
    fake.donguler = []
    fake.channel.mockClear()
    olusan = []
    class SahteBildirim {
      constructor(baslik, secenek) { this.baslik = baslik; this.secenek = secenek; this.close = vi.fn(); olusan.push(this) }
    }
    SahteBildirim.permission = 'granted'
    SahteBildirim.requestPermission = vi.fn(async () => 'granted')
    vi.stubGlobal('Notification', SahteBildirim)
    localStorage.setItem('voxen.yer', 'ana')
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  async function uygulamayiAc() {
    rpcKur()
    await startApp(document.querySelector('#app'), profil)
    await bosalt()
  }

  it('kart açıkken başkasını arayınca (📞) kart decline ile kapanır, zil durur', async () => {
    liste = [dmSatir('t1', ali), dmSatir('t2', veli)]
    baslatma = () => ({ data: { id: 'c2', status: 'ringing' }, error: null })
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    dmSatiri('veli').click()
    await bosalt()
    araDugmesi().click()
    await bosalt()
    expect(kart()).toBeNull()
    expect(zil()[0].durdu).toBe(true)
    expect(cagrilar('end_dm_call')).toEqual([{ id: 'c7', reason: 'decline' }])
    expect(panel().classList.contains('araniyor')).toBe(true)
  })

  it('kart açıkken aynı kişiyi arayınca (karşılıklı arama) kart yalnız kapanır, reddedilmez', async () => {
    baslatma = () => ({ data: { id: 'c7', status: 'active' }, error: null }) // sunucu c7'yi kabul etti
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    dmSatiri('ali').click()
    await bosalt()
    araDugmesi().click()
    await bosalt()
    expect(kart()).toBeNull()
    expect(zil()[0].durdu).toBe(true)
    expect(cagrilar('end_dm_call')).toEqual([])
    expect(dmSesKonulari()).toEqual(['dm-voice:c7'])
  })

  it('kart açıkken sesli kanala girilince kart decline ile kapanır, zil durur', async () => {
    localStorage.setItem('voxen.yer', 'sunucu')
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    kanalaTikla('Lobi')
    await bosalt()
    expect(kart()).toBeNull()
    expect(zil()[0].durdu).toBe(true)
    expect(cagrilar('end_dm_call')).toEqual([{ id: 'c7', reason: 'decline' }])
    expect(fake.voice).toBe(1)
  })

  it('Kabul sürerken (answerCall beklenirken) 📞 pasif; ikinci ringing kart çıkmadan decline ile kapanır', async () => {
    liste = [dmSatir('t1', ali), dmSatir('t2', veli)]
    let coz
    cevap = ({ id }) => new Promise((r) => { coz = () => r({ data: { id, status: 'active' }, error: null }) })
    await uygulamayiAc()
    dmSatiri('veli').click()
    await bosalt()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    expect(araDugmesi().getAttribute('aria-disabled')).toBeNull()
    kart().querySelector('.incoming-accept').click()
    await bosalt()
    expect(cagrilar('answer_dm_call')).toEqual([{ id: 'c7' }])
    expect(araDugmesi().getAttribute('aria-disabled')).toBe('true')
    expect(araDugmesi().dataset.tip).toBe('Zaten bir aramadasın.')
    araDugmesi().click()
    await bosalt()
    expect(cagrilar('start_dm_call')).toEqual([])
    olay({ call_id: 'c9', status: 'ringing', thread_id: 't2', caller: 'u3' })
    await bosalt()
    expect(kart()).toBeNull()
    expect(zil()).toHaveLength(1) // yalnız c7'nin zili çalmıştı
    expect(cagrilar('end_dm_call')).toEqual([{ id: 'c9', reason: 'decline' }])
    coz()
    await bosalt()
    expect(dmSesKonulari()).toEqual(['dm-voice:c7'])
    expect(panel().classList.contains('konusma')).toBe(true)
  })

  it('📞 basılıp startCall dönmeden Kabul edilirse: giden arama cancel ile biter, kabul edilen aramaya bağlanılır', async () => {
    liste = [dmSatir('t1', ali), dmSatir('t2', veli)]
    let baslatCoz
    let cevapCoz
    baslatma = () => new Promise((r) => { baslatCoz = () => r({ data: { id: 'c2', status: 'ringing' }, error: null }) })
    cevap = ({ id }) => new Promise((r) => { cevapCoz = () => r({ data: { id, status: 'active' }, error: null }) })
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    dmSatiri('veli').click()
    await bosalt()
    araDugmesi().click() // startCall sürüyor (kart hâlâ açık: ret ancak startCall dönünce)
    await bosalt()
    expect(kart()).not.toBeNull()
    kart().querySelector('.incoming-accept').click() // answerCall sürüyor
    await bosalt()
    baslatCoz() // giden arama c2 açıldı ("Aranıyor…")
    await bosalt()
    expect(cagrilar('end_dm_call')).toEqual([]) // kart zaten kapalı: c7 reddedilmez
    cevapCoz() // c7 kabul edildi
    await bosalt()
    expect(cagrilar('end_dm_call')).toEqual([{ id: 'c2', reason: 'cancel' }])
    expect(dmSesKonulari()).toEqual(['dm-voice:c7'])
    expect(panel().classList.contains('konusma')).toBe(true)
    expect(fake.donguler.find((d) => d.ad === 'bekleme').durdu).toBe(true)
  })

  it('kart kapanınca tarayıcıdaki "ali seni arıyor" bildirimi de kapanır', async () => {
    odak = false
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    expect(olusan[0].close).not.toHaveBeenCalled()
    olay({ call_id: 'c7', status: 'ended', reason: 'cancel' })
    await bosalt()
    expect(olusan[0].close).toHaveBeenCalledTimes(1)
  })

  it('başkasından ringing: "ali seni arıyor" kartı ve zil; Kabul et -> answer, DM açılır, konuşma paneli', async () => {
    await uygulamayiAc()
    expect(araDugmesi()).toBeNull() // Arkadaşlar sayfası açık
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    expect(kartBasligi()).toBe('ali seni arıyor')
    expect(kart().getAttribute('role')).toBe('alertdialog')
    expect(zil()).toHaveLength(1)
    expect(olusan).toHaveLength(0) // pencere odakta: masaüstü bildirimi yok
    kart().querySelector('.incoming-accept').click()
    await bosalt()
    expect(cagrilar('answer_dm_call')).toEqual([{ id: 'c7' }])
    expect(kart()).toBeNull()
    expect(zil()[0].durdu).toBe(true)
    expect(dmSesKonulari()).toEqual(['dm-voice:c7'])
    expect(araDugmesi().getAttribute('aria-label')).toBe('Aramadasın') // ali'nin DM'i açık
    expect(panel().classList.contains('konusma')).toBe(true)
    expect(panel().querySelector('.call-status').textContent).toBe('Bağlanıyor…')
    expect(cagrilar('end_dm_call')).toEqual([])
    // Karşı taraf kapatınca panel kapanır
    olay({ call_id: 'c7', status: 'ended', reason: 'hangup' })
    await bosalt()
    expect(panel()).toBeNull()
  })

  it('kendi aramamızın ringing olayı kart göstermez', async () => {
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing', caller: 'u1' })
    await bosalt()
    expect(kart()).toBeNull()
    expect(zil()).toHaveLength(0)
    expect(cagrilar('end_dm_call')).toEqual([])
  })

  it('Reddet: end_dm_call decline, kart kapanır, zil durur', async () => {
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    kart().querySelector('.incoming-decline').click()
    await bosalt()
    expect(cagrilar('end_dm_call')).toEqual([{ id: 'c7', reason: 'decline' }])
    expect(kart()).toBeNull()
    expect(zil()[0].durdu).toBe(true)
    expect(cagrilar('answer_dm_call')).toEqual([])
  })

  it('arayan vazgeçince (ended) ya da başka penceremizde cevaplanınca (active) kart kapanır', async () => {
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    olay({ call_id: 'c7', status: 'ended', reason: 'cancel' })
    await bosalt()
    expect(kart()).toBeNull()
    expect(zil()[0].durdu).toBe(true)
    olay({ call_id: 'c8', status: 'ringing' })
    await bosalt()
    expect(kart()).not.toBeNull()
    olay({ call_id: 'c8', status: 'active' })
    await bosalt()
    expect(kart()).toBeNull()
    expect(dmSesKonulari()).toEqual([]) // bu pencere sese girmez
  })

  it('aramadayken gelen başka arama: kart çıkmaz, decline ile kapanır', async () => {
    liste = [dmSatir('t1', ali), dmSatir('t2', veli)]
    await uygulamayiAc()
    dmSatiri('ali').click()
    await bosalt()
    araDugmesi().click() // start_dm_call bu testte hemen 'active' döner: doğrudan konuşma (c1)
    await bosalt()
    expect(panel().classList.contains('konusma')).toBe(true)
    olay({ call_id: 'c9', status: 'ringing', thread_id: 't2', caller: 'u3' })
    await bosalt()
    expect(kart()).toBeNull()
    expect(zil()).toHaveLength(0)
    expect(cagrilar('end_dm_call')).toEqual([{ id: 'c9', reason: 'decline' }])
    expect(dmSesKonulari()).toEqual(['dm-voice:c1'])
  })

  it('birini ararken ("Aranıyor…") gelen başka arama da decline ile kapanır', async () => {
    liste = [dmSatir('t1', ali), dmSatir('t2', veli)]
    baslatma = () => ({ data: { id: 'c1', status: 'ringing' }, error: null })
    await uygulamayiAc()
    dmSatiri('ali').click()
    await bosalt()
    araDugmesi().click()
    await bosalt()
    expect(panel().classList.contains('araniyor')).toBe(true)
    olay({ call_id: 'c9', status: 'ringing', thread_id: 't2', caller: 'u3' })
    await bosalt()
    expect(kart()).toBeNull()
    expect(cagrilar('end_dm_call')).toEqual([{ id: 'c9', reason: 'decline' }])
    expect(panel().classList.contains('araniyor')).toBe(true) // kendi aramamız sürer
  })

  it('konuşma listede yoksa liste tazelenir, ad oradan gelir; yine yoksa "Biri seni arıyor"', async () => {
    liste = []
    await uygulamayiAc()
    const once = cagrilar('dm_list').length
    liste = [dmSatir('t5', veli)]
    olay({ call_id: 'c5', status: 'ringing', thread_id: 't5', caller: 'u3' })
    await bosalt()
    expect(cagrilar('dm_list').length).toBeGreaterThan(once)
    expect(kartBasligi()).toBe('veli seni arıyor')
    kart().querySelector('.incoming-decline').click()
    await bosalt()
    olay({ call_id: 'c6', status: 'ringing', thread_id: 't6', caller: 'u4' })
    await bosalt()
    expect(kartBasligi()).toBe('Biri seni arıyor')
  })

  it('liste tazelenirken arama biterse kart hiç çıkmaz', async () => {
    liste = []
    await uygulamayiAc()
    let birak
    supabase.rpc.mockImplementation(async (ad) => {
      if (ad === 'dm_list') { await new Promise((r) => { birak = r }); return { data: [dmSatir('t5', veli)], error: null } }
      return { data: [], error: null }
    })
    olay({ call_id: 'c5', status: 'ringing', thread_id: 't5', caller: 'u3' })
    await bosalt()
    olay({ call_id: 'c5', status: 'ended', thread_id: 't5', caller: 'u3', reason: 'cancel' })
    birak()
    await bosalt()
    expect(kart()).toBeNull()
    expect(zil()).toHaveLength(0)
  })

  it('pencere arkadaysa "ali" / "ali seni arıyor" bildirimi; tıklayınca pencere öne gelir, kart görünür kalır', async () => {
    odak = false
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    expect(olusan).toHaveLength(1)
    expect(olusan[0].baslik).toBe('ali')
    expect(olusan[0].secenek.body).toBe('ali seni arıyor')
    olusan[0].onclick()
    await bosalt()
    expect(window.focus).toHaveBeenCalled()
    expect(kart()).not.toBeNull()
    expect(cagrilar('answer_dm_call')).toEqual([]) // bildirimden kabul edilmez
    expect(zil()).toHaveLength(1)
  })

  it('Rahatsız etmeyin: kart görünür ama zil ve masaüstü bildirimi yok', async () => {
    odak = false
    localStorage.setItem('voxen.presence', JSON.stringify({ dnd: true }))
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    expect(kartBasligi()).toBe('ali seni arıyor')
    expect(zil()).toHaveLength(0)
    expect(olusan).toHaveLength(0)
  })

  it('"Bildirim sesi" kapalı: zil yok (bildirim gelir); "Masaüstü bildirimleri" kapalı: bildirim yok (zil çalar)', async () => {
    odak = false
    localStorage.setItem('voxen.bildirimler', JSON.stringify({ masaustu: true, ses: false }))
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    expect(kart()).not.toBeNull()
    expect(zil()).toHaveLength(0)
    expect(olusan).toHaveLength(1)
    kart().querySelector('.incoming-decline').click()
    await bosalt()
    localStorage.setItem('voxen.bildirimler', JSON.stringify({ masaustu: false, ses: true }))
    olay({ call_id: 'c8', status: 'ringing' })
    await bosalt()
    expect(kart()).not.toBeNull()
    expect(zil()).toHaveLength(1)
    expect(olusan).toHaveLength(1)
  })

  it('sesli kanaldayken kabul edilince kanaldan çıkılır ve DM açılır', async () => {
    localStorage.setItem('voxen.yer', 'sunucu')
    await uygulamayiAc()
    kanalaTikla('Lobi')
    await bosalt()
    expect(fake.voice).toBe(1)
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    kart().querySelector('.incoming-accept').click()
    await bosalt()
    expect(fake.voice).toBe(0)
    expect(toastlar()).toContain('Sesli kanaldan ayrıldın.')
    expect(dmSesKonulari()).toEqual(['dm-voice:c7'])
    expect(panel().classList.contains('konusma')).toBe(true)
    expect(araDugmesi().getAttribute('aria-label')).toBe('Aramadasın')
  })

  it('kabul ederken arama bitmişse: "Arama sona erdi.", sese girilmez', async () => {
    cevap = () => ({ data: null, error: { message: 'NOT_RINGING' } })
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    kart().querySelector('.incoming-accept').click()
    await bosalt()
    expect(kart()).toBeNull()
    expect(toastlar()).toContain('Arama sona erdi.')
    expect(dmSesKonulari()).toEqual([])
    expect(panel()).toBeNull()
  })

  it('uygulama durunca (çıkış / stopApp) kart kapanır, zil durur', async () => {
    await uygulamayiAc()
    olay({ call_id: 'c7', status: 'ringing' })
    await bosalt()
    stopApp()
    expect(kart()).toBeNull()
    expect(zil()[0].durdu).toBe(true)
  })
})
