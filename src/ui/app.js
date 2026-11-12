// Giriş yapılmış kullanıcının ana ekranı: sunucu şeridi + kanal paneli + ana alan.
import { signOut } from '../auth/auth.js'
import { openProfileModal } from '../auth/profileModal.js'
import { createServer, inviteToCopy, joinByInvite, listMyServers } from '../data/servers.js'
import { createChannel, listChannels } from '../data/channels.js'
import { inviteFromHash, parseInviteInput, takePendingInvite } from './invite.js'
import { mountLayout, openModal, toast } from './layout.js'
import { renderRail } from './serverRail.js'
import { renderChannelList, updateSpeakingRings, voiceMembersByChannel } from './channelList.js'
import { createVoiceSession } from '../voice/session.js'
import { openMicTest } from './micTest.js'
import { openSettings, askPttKeyIfNeeded } from './settings.js'
import { PttController, pttBeepName, connectDesktopPtt, pttHintText, PTT_HOOK_ERROR_TEXT } from '../voice/ptt.js'
import { isTauri, loadTauriApi } from '../desktop.js'
import { createUpdateBanner } from './updateBanner.js'
import { getSettings, onSettingsChange } from '../settings.js'
import { playBeep } from '../voice/sounds.js'
import { mountChat } from './chatView.js'
import { listMembers } from '../data/members.js'
import { onPresenceChange, otherClientVoiceChannel, startPresence } from '../presence/presence.js'
import { getLocalPresencePrefs } from '../auth/profilePrefs.js'
import { renderMemberList } from './memberList.js'

// Son seçilen sunucu/kanal tarayıcıda hatırlanır (sadece kolaylık için).
function sonuOku() {
  try { return JSON.parse(localStorage.getItem('voxen.last')) ?? {} } catch { return {} }
}
function sonuYaz(serverId, channelId) {
  try { localStorage.setItem('voxen.last', JSON.stringify({ serverId, channelId })) } catch { /* sorun değil */ }
}

// Etiket + yazı kutusu çifti (pencerelerde kullanılır)
function girdi(etiket, max) {
  const l = document.createElement('label')
  l.textContent = etiket
  const i = document.createElement('input')
  i.type = 'text'
  i.maxLength = max
  return { etiket: l, input: i }
}

let aktifDurdur = null // önceki uygulamanın varlığı tamamen durduran fonksiyonu (aynı anda en fazla bir tane)

// Oturum Çıkış düğmesi dışında bittiğinde (başka sekmede çıkış, süresi dolan oturum) main.js çağırır:
// sesli kanaldan ayrılır, mikrofonu/varlığı/bas-konuşu durdurur. Uygulama açık değilse bir şey yapmaz.
export function stopApp() {
  aktifDurdur?.()
}

// Üye listesini en sık bu aralıkla yeniden yükleriz (varlık her değiştiğinde sorgu atmamak için)
const UYE_YENILEME_MS = 2000

export async function startApp(root, profile) {
  const { rail, channels: panel, main, members: uyePaneli } = mountLayout(root)
  let uyeler = []
  let varlikHaritasi = new Map() // kim çevrimiçi: userId -> { status, statusText }

  // Çevrimiçi durumu: giriş yapılınca başlar, Çıkış'ta durur. Tercihler tarayıcıda saklanır.
  aktifDurdur?.() // önceki startApp kalmışsa: izleyiciyi durdur + dinleyicisini bırak
  // Konuşma kapısı açıkken (oyunda bas-konuşla konuşurken fare/klavye Voxen'e gitmez) boşta sayılma
  let konusuyor = false
  const varlik = startPresence(profile.id, getLocalPresencePrefs, { isActive: () => konusuyor })
  let ses = null // açık sesli oturum (aynı anda en fazla bir sesli kanal)
  let sesKanalAdi = ''
  let ilkCizimYapildi = false
  const dinlemeyiBirak = onPresenceChange((harita) => {
    varlikHaritasi = harita
    cizUyeler()
    // Sesli kanallardaki kişiler ve kendi durum noktamız değişmiş olabilir: kanal panelini yenile
    if (ilkCizimYapildi) cizKanalPaneli()
    // Listede olmayan biri çevrimiçi göründüyse (yeni katılan üye olabilir) üyeleri yenile
    if (ilkCizimYapildi) uyeleriGerekirseYenile()
  })

  // Bas-konuş / sesle algılama: kapıyı açıp kapatan denetleyici (uygulama boyunca tek tane)
  // Masaüstünde tuşları Rust'taki sistem çapında dinleyici bildirir (oyun öndeyken de çalışsın)
  const masaustu = isTauri()
  const ayar0 = getSettings()
  const ptt = new PttController({
    listen: !masaustu,
    mode: ayar0.mode,
    key: ayar0.pttKey,
    threshold: ayar0.vadThreshold,
    getLevel: () => ses?.getLevel() ?? 0,
    onGate: (acik) => {
      ses?.setTransmitting(acik)
      konusuyor = acik
      if (acik) varlik.activity() // konuşmaya başladı: boştaysa hemen çevrimiçi ol
      // Bip sadece bas-konuş modunda, susturulmamış/sağır değilken çalar
      if (ses) {
        const bip = pttBeepName(acik, { mode: getSettings().mode, ...ses.getState() })
        if (bip) playBeep(bip)
      }
    },
  })
  // Ayarlar değişince canlı oturuma uygula (mikrofon cihazı hariç: o sonraki katılışta geçerli)
  const ayarDinlemeyiBirak = onSettingsChange((s) => {
    if (s.mode !== ptt.mode) ptt.setMode(s.mode)
    if (s.pttKey !== ptt.key) ptt.setKey(s.pttKey)
    ptt.setThreshold(s.vadThreshold)
    ses?.setNoiseSuppression(s.noiseSuppression)
    ses?.setBitrate(s.bitrateKbps)
    ses?.setOutputDevice(s.outputDeviceId)
    if (ses) cizKanalPaneli() // "tuş seçilmedi" ipucu değişmiş olabilir
  })
  // Masaüstü: Rust tuş dinleyicisine bağlan; tepsi menüsündeki "Sustur" sesli kanaldaysak susturur
  let masaustuBirak = []
  let durduruldu = false
  let kancaHatasi = false // klavye kancası çalışmıyor: bas-konuş tuşu algılanamaz
  let guncellemeBandi = null
  if (masaustu) {
    loadTauriApi().then(async (api) => {
      guncellemeBandi = createUpdateBanner({
        isInVoice: () => !!ses,
        onInstall: () => api.invoke('install_update'),
        onError: (e) => toast(`Güncellenemedi: ${e?.message ?? e}`),
      })
      const birakanlar = [
        await api.listen('update-available', (o) => guncellemeBandi?.offer(o.payload)),
        await connectDesktopPtt(ptt, api, {
          onHookError: () => {
            if (durduruldu) return
            if (!kancaHatasi) toast(PTT_HOOK_ERROR_TEXT)
            kancaHatasi = true
            if (ses) cizKanalPaneli()
          },
        }),
        await api.listen('tray-toggle-mute', () => ses?.toggleMute()),
      ]
      if (durduruldu) birakanlar.forEach((f) => f())
      else masaustuBirak = birakanlar
      // Olay web yüklenmeden önce gönderilmiş olabilir: bekleyen güncelleme var mı sor
      const bekleyen = await api.invoke('pending_update')
      if (bekleyen && !durduruldu) guncellemeBandi.offer(bekleyen)
    }).catch((e) => toast(`Masaüstü bağlantısı kurulamadı: ${e?.message ?? e}`))
  }
  // Ses panelindeki ipucu: bas-konuşta tuş yoksa kapı kapalı kalır
  function pttIpucu() {
    const s = getSettings()
    return pttHintText({ mode: s.mode, pttKey: s.pttKey, hookError: kancaHatasi })
  }
  function benimDurumum() { return varlikHaritasi.get(profile.id)?.status ?? 'online' }
  // Sayfa kapanırken sesli kanaldan ayrıl (karşıdakilere bye gider)
  const sayfaKapaniyor = () => sesliAyril(false)
  window.addEventListener('pagehide', sayfaKapaniyor)
  function varligiDurdur() {
    sesliAyril(false)
    window.removeEventListener('pagehide', sayfaKapaniyor)
    dinlemeyiBirak()
    ayarDinlemeyiBirak()
    ptt.dispose()
    durduruldu = true
    guncellemeBandi?.dispose()
    masaustuBirak.forEach((f) => f())
    masaustuBirak = []
    varlik.stop()
    clearTimeout(uyeZamanlayici)
    if (aktifDurdur === varligiDurdur) aktifDurdur = null
  }
  aktifDurdur = varligiDurdur
  function cizUyeler() { renderMemberList(uyePaneli, { members: uyeler, presence: varlikHaritasi }) }

  // Canlı üye yenileme: varlıkta, seçili sunucunun üye listesinde OLMAYAN biri varsa üyeleri yeniden yükle.
  // (Varlık kanalı tüm sunucular için ortak; başka sunucudan kişiler de görünür. Bu yüzden
  //  en fazla 2 sn'de bir ve aynı anda tek sorgu.)
  let uyeSunucusu = null // uyeler dizisi hangi sunucunun? (ilk yükleme bitmeden yenileme yapma)
  let uyeYukleniyor = false
  let sonUyeYukleme = 0
  let uyeZamanlayici = null
  function uyeleriGerekirseYenile() {
    if (!sunucuId || uyeSunucusu !== sunucuId || uyeYukleniyor || uyeZamanlayici) return
    const bilinmeyenVar = [...varlikHaritasi.keys()].some((id) => !uyeler.some((u) => u.id === id))
    if (!bilinmeyenVar) return
    const bekle = sonUyeYukleme + UYE_YENILEME_MS - Date.now()
    if (bekle > 0) {
      // Çok yakında yüklendi: süre dolunca bir kez daha bak
      uyeZamanlayici = setTimeout(() => { uyeZamanlayici = null; uyeleriGerekirseYenile() }, bekle)
      return
    }
    const id = sunucuId
    uyeYukleniyor = true
    sonUyeYukleme = Date.now()
    listMembers(id)
      .then((liste) => {
        if (sunucuId !== id || durduruldu) return // beklerken sunucu değişti ya da uygulama kapandı
        uyeler = liste
        cizUyeler()
        cizKanalPaneli() // sesli kanaldaki kişiler de üye listesinden gelir
      })
      .catch(() => { /* sessizce geç: bir sonraki varlık değişiminde tekrar denenir */ })
      .finally(() => { uyeYukleniyor = false })
  }
  let servers = []
  let kanallar = []
  let sunucuId = null
  let kanalId = null // panelde vurgulanan kanal (sesli de olabilir)
  let yaziliId = null // sohbeti açık olan yazılı kanal
  let sohbet = null // açık sohbet (destroy() ile kapatılır)
  let acikSohbetId = null

  // Ana alan: sohbet her zaman SON SEÇİLEN YAZILI kanalı gösterir (sesli kanala tıklamak onu değiştirmez).
  // Aynı kanal zaten açıksa yeniden kurmayız; değişince eski sohbetin aboneliği kapatılır.
  function cizMain() {
    const kanal = kanallar.find((k) => k.id === yaziliId && k.kind === 'text')
    if ((kanal?.id ?? null) === acikSohbetId) return
    sohbet?.destroy()
    sohbet = null
    acikSohbetId = kanal?.id ?? null
    main.innerHTML = ''
    if (kanal) sohbet = mountChat(main, { channel: kanal, profile })
  }

  function cizHepsi() {
    renderRail(rail, servers, sunucuId, { onSelect: (id) => sunucuSec(id), onAdd: sunucuOlustur, onJoin: sunucuyaKatil })
    cizKanalPaneli()
    cizMain()
  }

  function cizKanalPaneli() {
    ilkCizimYapildi = true
    const sunucu = servers.find((s) => s.id === sunucuId)
    renderChannelList(panel, {
      server: sunucu,
      channels: kanallar,
      profile,
      myStatus: benimDurumum(),
      selectedChannelId: kanalId,
      voiceMembers: voiceMembersByChannel(uyeler, varlikHaritasi),
      speaking: ses?.getState().speaking ?? new Set(),
      presence: varlikHaritasi,
      // Sesli kanaldaysak alttaki ses paneli
      voice: ses
        ? {
            channelName: sesKanalAdi,
            state: ses.getState(),
            pttHint: pttIpucu(),
            handlers: {
              onToggleMute: () => ses.toggleMute(),
              onToggleDeafen: () => ses.toggleDeafen(),
              onLeave: () => sesliAyril(),
            },
          }
        : null,
      handlers: {
        onSelectChannel: kanalSec,
        onAddChannel: kanalEkle,
        onCopyInvite: () => davetKopyala(sunucu),
        onMicTest: () => openMicTest(),
        onSettings: () => openSettings({ ptt, onProfile: profilAc }),
        onProfile: profilAc,
        onSignOut: () => { varligiDurdur(); signOut() },
      },
    })
  }

  // Susturma/sağırlaştırma değişince presence ile herkese duyur (sadece DEĞİŞİNCE gönder).
  // Sağırlaştırma susturmayı da getirir; ama durumlar ayrı yayınlanır, liste "sağır" simgesini seçer.
  let sonYayin = { muted: false, deafened: false }
  function sesDurumunuYayinla(oturum) {
    const { muted, deafened } = oturum.getState()
    if (muted === sonYayin.muted && deafened === sonYayin.deafened) return
    sonYayin = { muted, deafened }
    varlik.update({ voiceMuted: muted, voiceDeafened: deafened })
  }

  // Profil penceresi (ayarlar ekranındaki "Profil" düğmesinden de açılır)
  function profilAc() {
    openProfileModal(profile, (yeni) => { profile = yeni; sohbet?.updateProfile(yeni); varlik.refresh(); cizHepsi(); cizUyeler() })
  }

  function kanalSec(id) {
    kanalId = id
    const kanal = kanallar.find((k) => k.id === id)
    // Sadece yazılı kanallar hatırlanır ve sohbeti açar
    if (kanal?.kind === 'text') {
      yaziliId = id
      sonuYaz(sunucuId, id)
    }
    if (kanal?.kind === 'voice') sesliKatil(kanal)
    cizHepsi()
  }

  // Sesli kanala katıl (önce varsa eskisinden ayrıl). Tıklama bir kullanıcı hareketi:
  // tarayıcı bu sayede mikrofon iznini sorabilir ve gelen sesi çalabilir.
  function sesliKatil(kanal) {
    if (ses?.channelId === kanal.id) return // zaten buradayız
    // Aynı hesap başka bir pencerede (ya da masaüstü programında) zaten sesli kanaldaysa katılma:
    // aynı kişi iki kez bağlanınca bağlantılar birbirini bozar.
    if (!ses && otherClientVoiceChannel(profile.id)) {
      toast('Bu hesap başka bir pencerede sesli kanalda')
      return
    }
    sesliAyril(false)
    const oturum = createVoiceSession({ channelId: kanal.id, userId: profile.id })
    ses = oturum
    guncellemeBandi?.refresh() // sesli kanala girildi: bant gizlenir
    sesKanalAdi = kanal.name
    // Durum değişince paneli yenile; konuşan halkalarını ise yeniden çizmeden güncelle
    oturum.on('change', () => {
      if (ses !== oturum) return
      sesDurumunuYayinla(oturum)
      cizKanalPaneli()
    })
    oturum.on('speaking', (konusanlar) => { if (ses === oturum) updateSpeakingRings(panel, konusanlar) })
    sonYayin = { muted: false, deafened: false }
    varlik.update({ voiceChannelId: kanal.id, voiceMuted: false, voiceDeafened: false })
    // Kayıtlı ayarları oturuma uygula; kapı bas-konuşta kapalı başlar (tuşa basılana kadar)
    const s = getSettings()
    oturum.setBitrate(s.bitrateKbps)
    oturum.setOutputDevice(s.outputDeviceId)
    oturum.setTransmitting(ptt.isOpen())
    askPttKeyIfNeeded(ptt) // tuş hiç seçilmediyse ilk katılışta sor
    oturum.join().catch((e) => toast(e.message))
  }

  // Sesli kanaldan ayrıl (Ayrıl düğmesi, Çıkış, sayfa kapanması)
  function sesliAyril(ciz = true) {
    if (!ses) return
    ses.leave()
    ses = null
    guncellemeBandi?.refresh()
    sonYayin = { muted: false, deafened: false }
    varlik.update({ voiceChannelId: null, voiceMuted: false, voiceDeafened: false })
    if (ciz) cizKanalPaneli()
  }

  // Sunucuyu seçer, kanallarını yükler; hatırlanan (yoksa ilk yazılı) kanalı açar.
  async function sunucuSec(id, tercihKanal) {
    sunucuId = id
    let liste = []
    try { liste = await listChannels(id) } catch (e) { toast(e.message) }
    if (sunucuId !== id) return // beklerken başka sunucu seçildi; bu sonuç eskidi
    kanallar = liste
    const yazili = kanallar.filter((k) => k.kind === 'text')
    const varsayilan = yazili.find((k) => k.id === tercihKanal) ?? yazili[0]
    yaziliId = varsayilan?.id ?? null
    kanalId = yaziliId ?? kanallar[0]?.id ?? null
    if (yaziliId) sonuYaz(sunucuId, yaziliId)
    cizHepsi()
    // Üye listesi (çevrimiçi/çevrimdışı gruplu)
    let uyeListesi = []
    try { uyeListesi = await listMembers(id) } catch (e) { toast(e.message) }
    if (sunucuId !== id) return
    uyeler = uyeListesi
    uyeSunucusu = id
    cizUyeler()
  }

  function sunucuOlustur() {
    const f = girdi('Sunucu adı', 40)
    openModal('Sunucu oluştur', [f.etiket, f.input], async () => {
      const ad = f.input.value.trim()
      if (ad.length < 1 || ad.length > 40) return 'Sunucu adı 1-40 karakter olmalı'
      try {
        const id = await createServer(ad)
        servers = await listMyServers()
        await sunucuSec(id)
      } catch (e) { return e.message }
      return null
    })
  }

  function kanalEkle(tur) {
    const f = girdi('Kanal adı', 30)
    const etiket = document.createElement('label')
    etiket.textContent = 'Tür'
    const sec = document.createElement('select')
    for (const [deger, yazi] of [['text', 'Yazılı'], ['voice', 'Sesli']]) {
      const o = document.createElement('option')
      o.value = deger
      o.textContent = yazi
      sec.appendChild(o)
    }
    sec.value = tur ?? 'text'
    openModal('Kanal ekle', [f.etiket, f.input, etiket, sec], async () => {
      const ad = f.input.value.trim()
      if (ad.length < 1 || ad.length > 30) return 'Kanal adı 1-30 karakter olmalı'
      try {
        const sonPozisyon = kanallar.reduce((m, k) => Math.max(m, k.position), -1) + 1
        await createChannel(sunucuId, ad, sec.value, sonPozisyon)
        kanallar = await listChannels(sunucuId)
        cizHepsi()
      } catch (e) { return e.message }
      return null
    })
  }

  // Masaüstünde web adresi ayarlı değilse link yerine kod kopyalanır (inviteToCopy)
  async function davetKopyala(sunucu) {
    const { text, message } = inviteToCopy(sunucu)
    try {
      await navigator.clipboard.writeText(text)
      toast(message)
    } catch { toast('Kopyalanamadı: ' + text) }
  }

  // Koda katılır, sunucu listesini yeniler ve o sunucuyu seçer. Hata olursa fırlatır.
  async function katilVeSec(kod) {
    const id = await joinByInvite(kod)
    servers = await listMyServers()
    await sunucuSec(id)
  }

  // Davet koduyla katılır (adresten ya da giriş öncesinde saklanandan). Başarılıysa true.
  async function davetiIsle(kod) {
    const adresiTemizle = () => history.replaceState(null, '', location.pathname + location.search)
    try {
      await katilVeSec(kod)
      adresiTemizle()
      return true
    } catch {
      toast('Davet linki geçersiz')
      adresiTemizle()
      return false
    }
  }

  // "Sunucuya katıl" penceresi: link ya da kod yazılır; geçersizse istek atılmaz.
  function sunucuyaKatil() {
    const f = girdi('Davet linki veya kodu', 200)
    openModal('Sunucuya katıl', [f.etiket, f.input], async () => {
      const girilen = parseInviteInput(f.input.value)
      if (!girilen) return 'Davet linki geçersiz'
      try { await katilVeSec(girilen) } catch { return 'Davet linki geçersiz' }
      return null
    }, 'Katıl')
  }

  // Başlangıç
  const kod = inviteFromHash() ?? takePendingInvite()
  try { servers = await listMyServers() } catch (e) { toast(e.message) }
  cizHepsi()
  if (kod && (await davetiIsle(kod))) return
  const son = sonuOku()
  const hedef = servers.find((s) => s.id === son.serverId) ?? servers[0]
  if (hedef) await sunucuSec(hedef.id, son.channelId)
}
