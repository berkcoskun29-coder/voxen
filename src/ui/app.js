// Giriş yapılmış kullanıcının ana ekranı: sunucu şeridi + kanal paneli + ana alan.
import { signOut } from '../auth/auth.js'
import { openProfileModal } from '../auth/profileModal.js'
import { createServer, inviteToCopy, joinByInvite, listMyServers } from '../data/servers.js'
import { createChannel, listChannels } from '../data/channels.js'
import { inviteFromHash, parseInviteInput, takePendingInvite } from './invite.js'
import { mountLayout, openModal, toast, createMemberToggle } from './layout.js'
import { renderRail } from './serverRail.js'
import { renderChannelList, updateSpeakingRings, voiceMembersByChannel, renderKindPicker, kanalTuruSimgesi } from './channelList.js'
import { formAlani } from './modal.js'
import { createVoiceSession } from '../voice/session.js'
import { openSettings, askPttKeyIfNeeded } from './settings.js'
import { PttController, pttBeepName, connectDesktopPtt, pttHintText, PTT_HOOK_ERROR_TEXT } from '../voice/ptt.js'
import { isTauri, loadTauriApi } from '../desktop.js'
import { createUpdateBanner } from './updateBanner.js'
import { getSettings, updateSettings, onSettingsChange } from '../settings.js'
import { playBeep } from '../voice/sounds.js'
import { mountChat, renderWelcome, renderLoadError } from './chatView.js'
import { listMembers } from '../data/members.js'
import { onPresenceChange, isClientOnline, onlineClientIds, startPresence, CLIENT_ID } from '../presence/presence.js'
import {
  subscribeVoiceStates, upsertVoiceState, clearVoiceState, getMyVoiceState, deleteStaleVoiceState,
  reassertVoiceState, flushVoiceStates,
} from '../data/voiceStates.js'
import { getLocalPresencePrefs, setLocalPresencePrefs } from '../auth/profilePrefs.js'
import { renderMemberList } from './memberList.js'
import { mountVideoPane, buildVideoPeers } from './videoPane.js'
import { installProfileCards } from './profileCard.js'

// Son seçilen sunucu/kanal tarayıcıda hatırlanır (sadece kolaylık için).
function sonuOku() {
  try { return JSON.parse(localStorage.getItem('voxen.last')) ?? {} } catch { return {} }
}
function sonuYaz(serverId, channelId) {
  try { localStorage.setItem('voxen.last', JSON.stringify({ serverId, channelId })) } catch { /* sorun değil */ }
}

// Etiket + yazı kutusu + kutunun altındaki hata satırı (pencerelerde kullanılır; bkz. modal.js formAlani)
function girdi(etiket, max) {
  const i = document.createElement('input')
  i.type = 'text'
  i.maxLength = max
  return formAlani(etiket, i)
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

export async function startApp(root, profile, { email = '' } = {}) {
  const { rail, channels: panel, main, members: uyePaneli } = mountLayout(root)
  // Ana alan: üstte kanal başlığı, altında görüntü bölmesi (sesli kanaldayken), en altta sohbet
  const baslikAlani = document.createElement('div')
  baslikAlani.className = 'header-host'
  const goruntuAlani = document.createElement('div')
  goruntuAlani.className = 'video-host'
  const sohbetAlani = document.createElement('div')
  sohbetAlani.className = 'chat-host'
  main.append(baslikAlani, goruntuAlani, sohbetAlani)
  // Sohbet başlığının sağındaki "Üyeler" düğmesi: tek düğme, her kanal açılışında başlığa taşınır
  const uyeDugmesi = createMemberToggle(uyePaneli)
  let goruntu = null // açık görüntü bölmesi (sesli kanaldayken)
  let uyeler = []
  let cubukDurumu = '' // çubuktaki durum satırının son çizilen hâli (bkz. cubukDurumunuYenile)
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
    cubukDurumunuYenile()
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
  let sonAyarlar = getSettings()
  // Ayarlar değişince canlı oturuma uygula (mikrofon cihazı hariç: o sonraki katılışta geçerli)
  const ayarDinlemeyiBirak = onSettingsChange((s) => {
    // Yalnız çubuktaki susturma tercihi değiştiyse oturuma yeniden uygulanacak bir şey yok
    // (oturumun kendisi zaten değişti; bkz. susturmayiDegistir)
    const yalnizSusturma = Object.keys(s).every((k) => k === 'muted' || k === 'deafened' || s[k] === sonAyarlar[k])
    sonAyarlar = s
    if (yalnizSusturma) return
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
        onError: (e) => toast(`Güncellenemedi: ${e?.message ?? e}`, 'hata'),
      })
      const birakanlar = [
        await api.listen('update-available', (o) => guncellemeBandi?.offer(o.payload)),
        await connectDesktopPtt(ptt, api, {
          onHookError: () => {
            if (durduruldu) return
            if (!kancaHatasi) toast(PTT_HOOK_ERROR_TEXT, 'hata')
            kancaHatasi = true
            if (ses) cizKanalPaneli()
          },
        }),
        await api.listen('tray-toggle-mute', () => susturmayiDegistir()), // çubuktaki Sustur ile aynı
      ]
      if (durduruldu) birakanlar.forEach((f) => f())
      else masaustuBirak = birakanlar
      // Olay web yüklenmeden önce gönderilmiş olabilir: bekleyen güncelleme var mı sor
      const bekleyen = await api.invoke('pending_update')
      if (bekleyen && !durduruldu) guncellemeBandi.offer(bekleyen)
    }).catch((e) => toast(`Masaüstü bağlantısı kurulamadı: ${e?.message ?? e}`, 'hata'))
  }
  // Ses panelindeki ipucu: bas-konuşta tuş yoksa kapı kapalı kalır
  function pttIpucu() {
    const s = getSettings()
    return pttHintText({ mode: s.mode, pttKey: s.pttKey, hookError: kancaHatasi })
  }
  function benimDurumum() { return varlikHaritasi.get(profile.id)?.status ?? 'online' }
  // Kullanıcı çubuğundaki durum (ikinci satır, nokta) değişince yalnız kanal panelini yeniden çiz
  function cubukDurumunuYenile() {
    const yeni = benimDurumum() + '|' + (varlikHaritasi.get(profile.id)?.statusText ?? '')
    if (yeni === cubukDurumu) return
    const ilk = cubukDurumu === ''
    cubukDurumu = yeni
    if (!ilk && ilkCizimYapildi) cizKanalPaneli()
  }

  // ---- Sustur / Sağırlaştır (kullanıcı çubuğu ve tepsi menüsü) ----
  // Tek durum: sesli kanaldaysak oturumun durumu (ses.getState()); değilsek kayıtlı tercih
  // (getSettings().muted/deafened) ve bir sonraki katılışta oturum bu tercihle başlar.
  // Kanaldayken de son seçim tercihe yazılır ki sonraki katılışta aynı kalsın.
  function susturmayiDegistir() {
    // Sağırken Sustur'a basmak sağırlığı da kaldırır (Discord gibi): simge boşuna çizili kalmasın
    const simdi = ses ? ses.getState() : getSettings()
    if (simdi.deafened && !simdi.listenOnly) {
      if (ses) {
        ses.setMuted(false)
        ses.setDeafened(false)
        updateSettings({ muted: false, deafened: false })
      } else {
        updateSettings({ muted: false, deafened: false })
        cizKanalPaneli()
      }
      return
    }
    if (ses) {
      if (ses.getState().listenOnly) return // mikrofon yok: hep susturulmuş, tercih bozulmasın
      ses.toggleMute() // 'change' olayı: voice_states'e yazılır, panel yeniden çizilir
      updateSettings({ muted: ses.getState().muted })
    } else {
      updateSettings({ muted: !getSettings().muted })
      cizKanalPaneli()
    }
  }
  function sagirlastirmayiDegistir() {
    if (ses) {
      ses.toggleDeafen()
      updateSettings({ deafened: ses.getState().deafened })
    } else {
      updateSettings({ deafened: !getSettings().deafened })
      cizKanalPaneli()
    }
  }

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
    profilKartlariniBirak()
    dinlemeyiBirak()
    ayarDinlemeyiBirak()
    ptt.dispose()
    durduruldu = true
    guncellemeBandi?.dispose()
    masaustuBirak.forEach((f) => f())
    masaustuBirak = []
    varlik.stop()
    clearTimeout(uyeZamanlayici)
    uyeDugmesi.dispose()
    if (aktifDurdur === varligiDurdur) aktifDurdur = null
  }
  aktifDurdur = varligiDurdur

  // Çıkış yap (Ayarlar > Hesap'taki kırmızı düğme). Sıra önemli:
  // önce varlık ve ses durdurulur, sesli durum satırı silinir, EN SON oturum kapanır.
  async function cikisYap() {
    varligiDurdur()
    // Önce sesli durum satırımız silinsin (oturum kapanınca silme yetkimiz kalmaz); ağ yoksa en fazla 3 sn
    await Promise.race([flushVoiceStates(), new Promise((r) => setTimeout(r, CIKIS_BEKLEME_MS))])
    signOut()
  }
  // (renderMemberList .sunucusuz sınıfını korur; sınıfı cizHepsi koyar/kaldırır. Burada sunucuId'ye
  //  bakılmaz: bu fonksiyon varlık dinleyicisi kurulurken, sunucuId tanımlanmadan önce de çağrılır.)
  function cizUyeler() { renderMemberList(uyePaneli, { members: uyeler, presence: varlikHaritasi }) }

  // ---- Profil kartı: avatara (üye listesi, sohbet, sesli kanaldakiler) tıklayınca ----
  // Kartın bilgisi tıklama anında buradan okunur: durum, durum yazısı, sesli kanal.
  function profilBilgisi(kisi) {
    const v = varlikHaritasi.get(kisi.id)
    const durum = kisi.id === profile.id ? benimDurumum() : (v?.status ?? 'offline')
    // Sesli kanal: önce bakılan sunucu, sonra kendi sesli kanalımızın sunucusu
    let kanalAdi = null
    // Çevrimdışı kişinin eski (takılı kalmış) ses satırı kartta gösterilmez; kanal listesi de gizler
    for (const sid of (durum === 'offline' ? [] : [sunucuId, ses ? sesSunucuId : null])) {
      const kanal = sid ? sesHaritasi(sid).get(kisi.id)?.channelId : null
      if (!kanal) continue
      kanalAdi = kanal === ses?.channelId ? sesKanalAdi : (kanallar.find((k) => k.id === kanal)?.name ?? null)
      if (kanalAdi) break
    }
    const bilgi = { status: durum, statusText: v?.statusText ?? '', voiceChannelName: kanalAdi }
    if (kisi.id === profile.id) {
      bilgi.statusText = getLocalPresencePrefs().statusText
      // Kendi kartımız: durum seçimi profil penceresindekiyle AYNI yoldan gider
      // (tercih yazılır, varlık yenilenir; gönderim sınırı presence.js'te kalır).
      bilgi.own = {
        onStatus: (dnd) => { setLocalPresencePrefs({ dnd }); varlik.refresh() },
        onEdit: profilAc,
      }
    }
    return bilgi
  }
  const profilKartlariniBirak = installProfileCards(root, profilBilgisi)

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
  // Sunucu listesi durumu: 'yukleniyor' | 'hazir' | 'hata'. Karşılama kartı yalnız liste GERÇEKTEN
  // boş geldiyse çıkar (yüklenemediyse "yeni kullanıcı" sanmayalım).
  let sunucuDurumu = 'yukleniyor'
  let davetIsleniyor = false // adresteki davetle katılırken kart bir anlığına yanıp sönmesin

  // Sunucu listesini yükler; başarılıysa durum 'hazir' olur. Hata olursa fırlatır.
  async function sunuculariYukle() {
    servers = await listMyServers()
    sunucuDurumu = 'hazir'
  }

  // Ana alan: sohbet her zaman SON SEÇİLEN YAZILI kanalı gösterir (sesli kanala tıklamak onu değiştirmez).
  // Aynı kanal zaten açıksa yeniden kurmayız; değişince eski sohbetin aboneliği kapatılır.
  // Hiç sunucu yoksa sohbet yerine karşılama kartı çizilir (acikSohbetId = 'karsilama');
  // sunucular yüklenemediyse hata kutusu ve "Yeniden dene" (acikSohbetId = 'hata').
  function cizMain() {
    const kanal = kanallar.find((k) => k.id === yaziliId && k.kind === 'text')
    let anahtar = kanal?.id ?? null
    if (sunucuDurumu === 'hata') anahtar = 'hata'
    else if (sunucuDurumu === 'hazir' && servers.length === 0 && !davetIsleniyor) anahtar = 'karsilama'
    if (anahtar === acikSohbetId) return
    sohbet?.destroy()
    sohbet = null
    acikSohbetId = anahtar
    sohbetAlani.innerHTML = ''
    baslikAlani.innerHTML = ''
    if (anahtar === 'karsilama') {
      // Düğmeler şeritteki + ve zincir düğmeleriyle aynı pencereleri açar
      sohbetAlani.appendChild(renderWelcome(profile, { onCreate: sunucuOlustur, onJoin: sunucuyaKatil }))
    } else if (anahtar === 'hata') {
      sohbetAlani.appendChild(renderLoadError('Sunucular yüklenemedi. Bağlantını kontrol edip yeniden dene.', yenidenDene))
    } else if (kanal) {
      sohbet = mountChat(sohbetAlani, { channel: kanal, profile, headerActions: [uyeDugmesi.button], headerHost: baslikAlani })
    }
  }

  function cizHepsi() {
    // Sunucu yokken (ya da henüz seçilmemişken) üye paneli boş kalırdı: gizle (CSS .sunucusuz)
    uyePaneli.classList.toggle('sunucusuz', !sunucuId)
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
      myStatusText: varlikHaritasi.get(profile.id)?.statusText ?? '',
      selectedChannelId: kanalId,
      audio: getSettings(), // sesli kanalda değilken çubuktaki Sustur/Sağırlaştır tercihi
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
        onToggleMute: susturmayiDegistir,
        onToggleDeafen: sagirlastirmayiDegistir,
        onSettings: () => openSettings({ ptt, onProfile: profilAc, onSignOut: cikisYap, account: { profile, email } }),
        onProfile: profilAc,
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
    openProfileModal(profile, (yeni) => {
      profile = yeni
      sohbet?.updateProfile(yeni)
      varlik.refresh()
      if (acikSohbetId === 'karsilama') acikSohbetId = null // karşılama kartı yeni adla yeniden çizilsin
      cizHepsi()
      cizUyeler()
    })
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
        toast('Bu hesap başka bir pencerede sesli kanalda', 'hata')
        return
      }
      if (ses?.channelId === kanal.id) return
    }
    sesliAyril(false)
    // Çubukta kanal dışındayken seçilen Sustur/Sağırlaştır tercihiyle başla
    const tercih = getSettings()
    const oturum = createVoiceSession({ channelId: kanal.id, userId: profile.id, muted: tercih.muted, deafened: tercih.deafened })
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
    oturum.join().catch((e) => toast(e.message, 'hata'))
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
    try { liste = await listChannels(id) } catch (e) { toast(e.message, 'hata') }
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
    try { uyeListesi = await listMembers(id) } catch (e) { toast(e.message, 'hata') }
    if (sunucuId !== id) return
    uyeler = uyeListesi
    uyeSunucusu = id
    if (ses && id === sesSunucuId) { sesUyeleri = uyeListesi; goruntu?.update() }
    cizUyeler()
  }

  // Sunucuya/kanala yazılamadığında (ağ, yetki): Supabase'in İngilizce metni yerine çözüm söyleyen metin
  const OLUSTURULAMADI = 'Oluşturulamadı. İnternetini kontrol edip tekrar dene.'

  function sunucuOlustur() {
    const f = girdi('Sunucu adı', 40)
    // Hata kutuyla ilgiliyse { alan, metin } döner: metin kutunun altına yazılır (modal.js)
    openModal('Sunucu oluştur', [f.etiket, f.input, f.hata], async () => {
      const ad = f.input.value.trim()
      if (ad.length < 1 || ad.length > 40) return { alan: f.input, metin: 'Sunucu adı boş olamaz. Bir ad yaz (en fazla 40 karakter).' }
      try {
        const id = await createServer(ad)
        await sunuculariYukle()
        await sunucuSec(id)
      } catch { return OLUSTURULAMADI }
      return null
    })
  }

  // tur: hangi bölümün "+ kanal"ından açıldı ('text' | 'voice'); o türün kartı seçili gelir
  function kanalEkle(tur) {
    const f = girdi('Kanal adı', 30)
    // Kutunun başında seçili türün simgesi (# ya da hoparlör)
    const onEk = document.createElement('span')
    onEk.className = 'input-prefix'
    onEk.setAttribute('aria-hidden', 'true')
    const simgeyiCiz = (t) => onEk.replaceChildren(kanalTuruSimgesi(t))
    const tursec = renderKindPicker(tur, simgeyiCiz)
    simgeyiCiz(tursec.secili())
    const sarma = document.createElement('div')
    sarma.className = 'input-wrap has-prefix'
    sarma.append(onEk, f.input)

    openModal('Kanal ekle', [tursec.baslik, tursec.kutu, f.etiket, sarma, f.hata], async () => {
      const ad = f.input.value.trim()
      if (ad.length < 1 || ad.length > 30) return { alan: f.input, metin: 'Kanal adı boş olamaz. Bir ad yaz (en fazla 30 karakter).' }
      try {
        const sonPozisyon = kanallar.reduce((m, k) => Math.max(m, k.position), -1) + 1
        await createChannel(sunucuId, ad, tursec.secili(), sonPozisyon)
        kanallar = await listChannels(sunucuId)
        cizHepsi()
      } catch { return OLUSTURULAMADI }
      return null
    })
  }

  // Masaüstünde web adresi ayarlı değilse link yerine kod kopyalanır (inviteToCopy)
  async function davetKopyala(sunucu) {
    const { text, message } = inviteToCopy(sunucu)
    try {
      await navigator.clipboard.writeText(text)
      toast(message, 'basari')
    } catch { toast('Kopyalanamadı: ' + text, 'hata') }
  }

  // Koda katılır, sunucu listesini yeniler ve o sunucuyu seçer. Hata olursa fırlatır.
  async function katilVeSec(kod) {
    const id = await joinByInvite(kod)
    await sunuculariYukle()
    await sunucuSec(id)
  }

  // Davet bulunamadığında (geçersiz/bozuk link ya da kod) gösterilen metin: çözümü de söyler
  const DAVET_BULUNAMADI = 'Bu davet bulunamadı. Linki yeniden kopyalayıp yapıştır.'

  // Davet koduyla katılır (adresten ya da giriş öncesinde saklanandan). Başarılıysa true.
  async function davetiIsle(kod) {
    const adresiTemizle = () => history.replaceState(null, '', location.pathname + location.search)
    try {
      await katilVeSec(kod)
      adresiTemizle()
      return true
    } catch {
      toast(DAVET_BULUNAMADI, 'hata')
      adresiTemizle()
      return false
    }
  }

  // "Sunucuya katıl" penceresi: link ya da kod yazılır; geçersizse istek atılmaz.
  function sunucuyaKatil() {
    const f = girdi('Davet linki veya kodu', 200)
    openModal('Sunucuya katıl', [f.etiket, f.input, f.hata], async () => {
      const girilen = parseInviteInput(f.input.value)
      const hata = { alan: f.input, metin: DAVET_BULUNAMADI } // hata kutunun altında, çözümüyle
      if (!girilen) return hata
      try { await katilVeSec(girilen) } catch { return hata }
      return null
    }, 'Katıl')
  }

  // Son açılan (yoksa ilk) sunucuyu seçer
  async function sonSunucuyuAc() {
    const son = sonuOku()
    const hedef = servers.find((s) => s.id === son.serverId) ?? servers[0]
    if (hedef) await sunucuSec(hedef.id, son.channelId)
  }

  // Hata kutusundaki "Yeniden dene": listeyi tekrar ister; olursa her şey yeniden çizilir
  async function yenidenDene() {
    try { await sunuculariYukle() } catch (e) { toast(e.message, 'hata'); return }
    cizHepsi()
    await sonSunucuyuAc()
  }

  // Başlangıç
  const kod = inviteFromHash() ?? takePendingInvite()
  try { await sunuculariYukle() } catch (e) { sunucuDurumu = 'hata'; toast(e.message, 'hata') }
  davetIsleniyor = !!kod
  cizHepsi()
  if (kod) {
    const katildi = await davetiIsle(kod)
    davetIsleniyor = false
    if (katildi) return
    cizMain() // davet geçersizdi: gerekirse karşılama kartı şimdi çıksın
  }
  await sonSunucuyuAc()
}
