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
import { onPresenceChange, isClientOnline, onlineClientIds, startPresence, CLIENT_ID } from '../presence/presence.js'
import {
  subscribeVoiceStates, upsertVoiceState, clearVoiceState, getMyVoiceState, deleteStaleVoiceState,
  reassertVoiceState, flushVoiceStates,
} from '../data/voiceStates.js'
import { getLocalPresencePrefs } from '../auth/profilePrefs.js'
import { renderMemberList } from './memberList.js'
import { mountVideoPane, buildVideoPeers } from './videoPane.js'

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

// Kendi pencerelerimizden biri varlıktan düşünce, satırını silmeden önce bu kadar bekleriz
// (kısa bir bağlantı kopukluğunda canlı pencerenin satırı silinmesin). Testler değiştirebilir.
export const appTiming = { staleWindowGraceMs: 10000 }
// Çıkış'ta sesli durum silmesini en fazla bu kadar bekleriz (ağ yoksa çıkış takılmasın)
const CIKIS_BEKLEME_MS = 3000

// Üye listesini en sık bu aralıkla yeniden yükleriz (varlık her değiştiğinde sorgu atmamak için)
const UYE_YENILEME_MS = 2000

export async function startApp(root, profile) {
  const { rail, channels: panel, main, members: uyePaneli } = mountLayout(root)
  // Ana alan: üstte görüntü bölmesi (sesli kanaldayken), altında sohbet
  const goruntuAlani = document.createElement('div')
  goruntuAlani.className = 'video-host'
  const sohbetAlani = document.createElement('div')
  sohbetAlani.className = 'chat-host'
  main.append(goruntuAlani, sohbetAlani)
  let goruntu = null // açık görüntü bölmesi (sesli kanaldayken)
  let uyeler = []
  let varlikHaritasi = new Map() // kim çevrimiçi: userId -> { status, statusText }

  // Çevrimiçi durumu: giriş yapılınca başlar, Çıkış'ta durur. Tercihler tarayıcıda saklanır.
  aktifDurdur?.() // önceki startApp kalmışsa: izleyiciyi durdur + dinleyicisini bırak
  // Konuşma kapısı açıkken (oyunda bas-konuşla konuşurken fare/klavye Voxen'e gitmez) boşta sayılma
  let konusuyor = false
  const varlik = startPresence(profile.id, getLocalPresencePrefs, { isActive: () => konusuyor })
  let ses = null // açık sesli oturum (aynı anda en fazla bir sesli kanal)
  let sesKanalAdi = ''
  let sesSunucuId = null // sesli kanalımızın sunucusu (başka sunucuya bakarken de bilinsin)
  // Sesli kanalımızın sunucusunun üyeleri: katılırken alınır, yalnız o sunucunun üyeleri yeniden
  // yüklenince yenilenir. Başka sunucuya bakarken (uyeler o sunucunun olur) görüntü bölmesi boşalmasın.
  let sesUyeleri = []
  let ilkCizimYapildi = false
  let eskiSatirBakildi = false
  let benimPencerelerim = new Set() // varlıkta en son gördüğümüz kendi pencerelerimiz (clientId)
  const dusenZamanlayicilar = new Map() // düşen pencere clientId -> silme zamanlayıcısı
  const dinlemeyiBirak = onPresenceChange((harita) => {
    varlikHaritasi = harita
    eskiSatiriTemizle()
    dusenPencereleriTemizle()
    odadakiEkraniBildir() // ekran paylaşan çevrimdışı olduysa kural kalkar
    cizUyeler()
    goruntu?.update() // kanaldakilerden kim çevrimiçi değişmiş olabilir
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
  let sonKameraCihazi = getSettings().cameraDeviceId
  // Ayarlar değişince canlı oturuma uygula (mikrofon cihazı hariç: o sonraki katılışta geçerli)
  const ayarDinlemeyiBirak = onSettingsChange((s) => {
    if (s.mode !== ptt.mode) ptt.setMode(s.mode)
    if (s.pttKey !== ptt.key) ptt.setKey(s.pttKey)
    ptt.setThreshold(s.vadThreshold)
    ses?.setNoiseSuppression(s.noiseSuppression)
    ses?.setBitrate(s.bitrateKbps)
    ses?.setUploadMbps(s.uploadMbps)
    ses?.setOutputDevice(s.outputDeviceId)
    // Kamera seçimi değişti ve kamera açıksa canlı geçir (mikrofondan farklı olarak)
    if (s.cameraDeviceId !== sonKameraCihazi) { sonKameraCihazi = s.cameraDeviceId; ses?.switchCamera() }
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

  // ---- Sesli kanal durumu (voice_states tablosu) ----
  // Seçili sunucunun ve (başka sunucuya bakıyorsak) sesli kanalımızın sunucusunun durumlarını dinleriz.
  // serverId -> { birak(), harita: Map<userId, durum> }
  const sesAbonelikleri = new Map()
  function sesAbonelikleriniAyarla() {
    const gerekli = new Set([sunucuId, ses ? sesSunucuId : null].filter(Boolean))
    for (const [id, a] of sesAbonelikleri) {
      if (!gerekli.has(id)) { a.birak(); sesAbonelikleri.delete(id) }
    }
    for (const id of gerekli) {
      if (sesAbonelikleri.has(id)) continue
      const a = { harita: new Map(), birak: () => {} }
      sesAbonelikleri.set(id, a)
      a.birak = subscribeVoiceStates(id, (h) => {
        if (sesAbonelikleri.get(id) !== a) return
        a.harita = h
        sesDurumlariDegisti()
      }, {
        // Kendi satırımız silindiyse (başka penceremiz bizi kapanmış sandı) ve hâlâ sesli kanaldaysak yeniden yaz
        onDelete: (userId) => { if (userId === profile.id && ses) reassertVoiceState() },
      })
    }
  }
  function sesAbonelikleriniKapat() {
    for (const a of sesAbonelikleri.values()) a.birak()
    sesAbonelikleri.clear()
  }
  // Birinin sesli durumu değişti: kanal listesi ve görüntü bölmesi yeniden çizilir
  function sesDurumlariDegisti() {
    if (durduruldu) return
    odadakiEkraniBildir()
    if (ilkCizimYapildi) cizKanalPaneli()
    goruntu?.update()
  }
  // Oda kuralı: kanalımızda (çevrimiçi) başka biri ekran paylaşıyorsa kameramız küçülür (videoBudget.js)
  function odadakiEkraniBildir() {
    if (!ses) return
    const cevrimici = cevrimiciler()
    let paylasanVar = false
    for (const [id, d] of sesHaritasi(sesSunucuId)) {
      if (id !== profile.id && d.channelId === ses.channelId && d.screen && cevrimici.has(id)) paylasanVar = true
    }
    ses.setRoomScreenOn?.(paylasanVar)
  }
  // Sunucunun sesli durumları. Yalnız satırı YAZAN pencere (client_id) hâlâ varlıkta görünüyorsa sayılır:
  // kişi başka bir pencereden çevrimiçi olsa bile kapanmış pencerenin satırı "hayalet" olarak kalmasın.
  // Kendi satırımız için sunucunun cevabını beklemeyiz: sesli kanaldaysak yerel oturumdan yazılır
  // (simge anında doğru), değilsek bu pencerenin eski satırı gösterilmez.
  function sesHaritasi(serverId) {
    const h = new Map()
    for (const [id, d] of sesAbonelikleri.get(serverId)?.harita ?? []) {
      if (id === profile.id && d.clientId === CLIENT_ID) continue
      if (isClientOnline(id, d.clientId)) h.set(id, d)
    }
    if (ses && sesSunucuId === serverId) {
      const { muted, deafened, camera, screen } = ses.getState()
      h.set(profile.id, { userId: profile.id, serverId, channelId: ses.channelId, clientId: CLIENT_ID, muted, deafened, camera, screen })
    }
    return h
  }
  // Sesli kanallarda yalnız çevrimiçi olanlar gösterilir; kendimiz (varlık henüz gelmediyse de) hep sayılırız
  function cevrimiciler() {
    if (varlikHaritasi.has(profile.id)) return varlikHaritasi
    return new Map(varlikHaritasi).set(profile.id, { status: 'online' })
  }

  // Kendi pencerelerimizden biri (ör. masaüstü programı) varlıktan düştüyse ve biz açıksak, onun satırını sil:
  // sayfa kapanırken silmesi gidemediyse herkes bizi o kanalda görmeye devam ederdi. Kısa kopuklukta
  // canlı pencerenin satırı silinmesin diye biraz bekleyip yeniden bakarız (geri gelirse dokunmayız;
  // yine de silinirse o pencere silme olayını görüp satırını yeniden yazar).
  function dusenPencereleriTemizle() {
    const simdiki = new Set(onlineClientIds(profile.id))
    for (const c of benimPencerelerim) {
      if (c === CLIENT_ID || simdiki.has(c) || dusenZamanlayicilar.has(c)) continue
      dusenZamanlayicilar.set(c, setTimeout(() => {
        dusenZamanlayicilar.delete(c)
        if (durduruldu || isClientOnline(profile.id, c) || !isClientOnline(profile.id, CLIENT_ID)) return
        deleteStaleVoiceState(profile.id, c).catch(() => { /* çevrimdışı satır zaten gösterilmez */ })
      }, appTiming.staleWindowGraceMs))
    }
    benimPencerelerim = simdiki
  }

  // Açılışta: kapanmış bir pencereden (çökme, sekme kapatma) kalmış kendi satırımızı sil.
  // Kimin açık olduğunu ancak varlık gelince biliriz: kendi girdimizi görünce bir kez bakılır.
  // Satırı hâlâ açık olan başka bir penceremiz yazdıysa dokunulmaz.
  function eskiSatiriTemizle() {
    if (eskiSatirBakildi || !isClientOnline(profile.id, CLIENT_ID)) return
    eskiSatirBakildi = true
    getMyVoiceState(profile.id)
      .then((satir) => {
        if (!satir || satir.clientId === CLIENT_ID || isClientOnline(profile.id, satir.clientId)) return
        return deleteStaleVoiceState(profile.id, satir.clientId)
      })
      .catch(() => { /* olmazsa önemli değil: çevrimdışı kişinin satırı zaten gösterilmez */ })
  }
  // Sayfa kapanırken sesli kanaldan ayrıl (karşıdakilere bye gider)
  const sayfaKapaniyor = () => sesliAyril(false, { hemen: true })
  window.addEventListener('pagehide', sayfaKapaniyor)
  function varligiDurdur() {
    sesliAyril(false, { hemen: true })
    sesAbonelikleriniKapat()
    for (const z of dusenZamanlayicilar.values()) clearTimeout(z)
    dusenZamanlayicilar.clear()
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
        if (ses && id === sesSunucuId) sesUyeleri = liste
        cizUyeler()
        cizKanalPaneli() // sesli kanaldaki kişiler de üye listesinden gelir
        goruntu?.update()
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
    sohbetAlani.innerHTML = ''
    if (kanal) sohbet = mountChat(sohbetAlani, { channel: kanal, profile })
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
      voiceMembers: voiceMembersByChannel(uyeler, sesHaritasi(sunucuId), cevrimiciler()),
      speaking: ses?.getState().speaking ?? new Set(),
      voiceStates: sesHaritasi(sunucuId),
      // Sesli kanaldaysak alttaki ses paneli
      voice: ses
        ? {
            channelName: sesKanalAdi,
            state: ses.getState(),
            pttHint: pttIpucu(),
            handlers: {
              onToggleMute: () => ses.toggleMute(),
              onToggleDeafen: () => ses.toggleDeafen(),
              onToggleCamera: () => ses.toggleCamera(),
              onToggleScreen: () => ses.toggleScreenShare(),
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
        onSignOut: async () => {
          varligiDurdur()
          // Önce sesli durum satırımız silinsin (oturum kapanınca silme yetkimiz kalmaz); ağ yoksa en fazla 3 sn
          await Promise.race([flushVoiceStates(), new Promise((r) => setTimeout(r, CIKIS_BEKLEME_MS))])
          signOut()
        },
      },
    })
  }

  // Susturma/sağırlaştırma/kamera/ekran değişince voice_states satırımıza yaz (herkes görsün).
  // Yazma kuyruğu hızlı tıklamaları birleştirir ve aynı durumu tekrar yazmaz (bkz. data/voiceStates.js).
  // Sağırlaştırma susturmayı da getirir; ama durumlar ayrı yazılır, liste "sağır" simgesini seçer.
  function sesDurumunuYayinla(oturum) {
    const { muted, deafened, camera, screen } = oturum.getState()
    upsertVoiceState({ userId: profile.id, serverId: sesSunucuId, channelId: oturum.channelId, muted, deafened, camera, screen })
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
  let katilmaNo = 0 // art arda tıklamada yalnız SON tıklama katılır
  async function sesliKatil(kanal) {
    if (ses?.channelId === kanal.id) return // zaten buradayız
    const no = ++katilmaNo
    // Aynı hesap başka bir pencerede (ya da masaüstü programında) zaten sesli kanaldaysa katılma:
    // aynı kişi iki kez bağlanınca bağlantılar birbirini bozar. Satırı yazan pencere hâlâ açık mı
    // (varlıkta görünüyor mu) diye bakarız; kapanmış pencereden kalan eski satır engel olmaz.
    if (!ses) {
      let satir = null
      try { satir = await getMyVoiceState(profile.id) } catch { /* bakamadık: katılmayı engelleme */ }
      if (no !== katilmaNo || durduruldu) return // beklerken başka bir yere tıklandı ya da uygulama kapandı
      if (satir && satir.clientId !== CLIENT_ID && isClientOnline(profile.id, satir.clientId)) {
        toast('Bu hesap başka bir pencerede sesli kanalda')
        return
      }
      if (ses?.channelId === kanal.id) return
    }
    sesliAyril(false)
    const oturum = createVoiceSession({ channelId: kanal.id, userId: profile.id })
    ses = oturum
    sesSunucuId = sunucuId
    sesUyeleri = uyeSunucusu === sunucuId ? uyeler : [] // üyeler henüz yüklenmediyse yüklenince gelir
    sesAbonelikleriniAyarla()
    guncellemeBandi?.refresh() // sesli kanala girildi: bant gizlenir
    sesKanalAdi = kanal.name
    // Durum değişince paneli yenile; konuşan halkalarını ise yeniden çizmeden güncelle
    oturum.on('change', () => {
      if (ses !== oturum) return
      sesDurumunuYayinla(oturum)
      cizKanalPaneli()
      goruntu?.update() // kendi kamera/ekran önizlememiz
    })
    oturum.on('notice', (metin) => { if (ses === oturum) toast(metin) }) // örn. kulaklık uyarısı
    oturum.on('speaking', (konusanlar) => {
      if (ses !== oturum) return
      updateSpeakingRings(panel, konusanlar)
      goruntu?.update() // kutucuklardaki yeşil çerçeve
    })
    oturum.on('tracks', () => { if (ses === oturum) goruntu?.update() })
    // Görüntü bölmesi: kanaldaki kişiler ve kim kamera/ekran açtı voice_states'ten, izler oturumdan
    goruntu = mountVideoPane(goruntuAlani, {
      getPeers: () => {
        const durumlar = sesHaritasi(sesSunucuId)
        return buildVideoPeers({
          self: profile,
          members: voiceMembersByChannel(sesUyeleri, durumlar, cevrimiciler()).get(kanal.id) ?? [],
          voiceStates: durumlar,
          session: oturum,
        })
      },
      onHide: (id, gizli) => { oturum.setScreenHidden(id, gizli); goruntu?.update() },
      onVolume: (id, v) => oturum.setScreenVolume(id, v),
    })
    goruntu.update()
    sesDurumunuYayinla(oturum) // satırımız: bu kanaldayız
    odadakiEkraniBildir() // kanalda zaten ekran paylaşan varsa
    // Kayıtlı ayarları oturuma uygula; kapı bas-konuşta kapalı başlar (tuşa basılana kadar)
    const s = getSettings()
    oturum.setBitrate(s.bitrateKbps)
    oturum.setUploadMbps(s.uploadMbps)
    oturum.setOutputDevice(s.outputDeviceId)
    oturum.setTransmitting(ptt.isOpen())
    askPttKeyIfNeeded(ptt) // tuş hiç seçilmediyse ilk katılışta sor
    oturum.join().catch((e) => toast(e.message))
    cizKanalPaneli() // ses paneli ve kanaldaki kendi satırımız
  }

  // Sesli kanaldan ayrıl (Ayrıl düğmesi, Çıkış, sayfa kapanması).
  // hemen: satırımızı beklemeden sil (sayfa kapanırken/çıkışta zamanlayıcıya güvenemeyiz)
  function sesliAyril(ciz = true, { hemen = false } = {}) {
    if (!ses) return
    ses.leave()
    ses = null
    sesUyeleri = []
    goruntu?.dispose() // videolar boşalır, iz dinleyicileri bırakılır
    goruntu = null
    guncellemeBandi?.refresh()
    clearVoiceState(profile.id, { now: hemen }) // satırımız silinir (olmazsa yeniden denenir)
    if (!durduruldu) sesAbonelikleriniAyarla() // başka sunucunun sesli durumlarına artık gerek yok
    if (ciz) cizKanalPaneli()
  }

  // Sunucuyu seçer, kanallarını yükler; hatırlanan (yoksa ilk yazılı) kanalı açar.
  async function sunucuSec(id, tercihKanal) {
    sunucuId = id
    sesAbonelikleriniAyarla() // bu sunucunun sesli kanallarında kim var
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
    if (ses && id === sesSunucuId) { sesUyeleri = uyeListesi; goruntu?.update() }
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
