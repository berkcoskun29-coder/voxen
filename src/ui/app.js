// Giriş yapılmış kullanıcının ana ekranı: sunucu şeridi + kanal paneli + ana alan.
import { signOut } from '../auth/auth.js'
import { openProfileModal } from '../auth/profileModal.js'
import { createServer, inviteToCopy, joinByInvite, listMyServers, leaveServer, deleteServer, renameServer } from '../data/servers.js'
import { createChannel, listChannels, deleteChannel, renameChannel, getChannel } from '../data/channels.js'
import { subscribeServerEvents } from '../data/serverEvents.js'
import {
  openServerMenu, openChannelMenu, closeMenu, leaveServerDialog, deleteServerDialog, deleteChannelDialog,
  renameChannelDialog, serverSettingsDialog,
} from './serverMenu.js'
import { inviteFromHash, parseInviteInput, takePendingInvite } from './invite.js'
import { mountLayout, openModal, toast, createMemberToggle, toastKutusunuAl } from './layout.js'
import { renderRail } from './serverRail.js'
import { renderChannelList, updateSpeakingRings, voiceMembersByChannel, renderKindPicker, kanalTuruSimgesi } from './channelList.js'
import { formAlani } from './modal.js'
import { createVoiceSession } from '../voice/session.js'
import { callTopic, endCall, startCall, answerCall, pingCall, getCallStatus, parseCallEvent } from '../data/calls.js'
import { createIncomingCall, zilCalsinMi, GELEN_ARAMA_METINLERI } from './incomingCall.js'
import { createCallFlow, mountCallPanel, createCallButton, aramaGorunumu, ARAMA_METINLERI } from './callPanel.js'
import { openSettings, askPttKeyIfNeeded } from './settings.js'
import { PttController, pttBeepName, connectDesktopPtt, pttHintText, PTT_HOOK_ERROR_TEXT } from '../voice/ptt.js'
import { isTauri, loadTauriApi, setWindowTitle } from '../desktop.js'
import { createUnreadTracker, baslikYazisi } from './unread.js'
import { flushReads, resetReads } from '../data/reads.js'
import { createUpdateBanner } from './updateBanner.js'
import { getSettings, updateSettings, onSettingsChange } from '../settings.js'
import { playBeep, startLoop } from '../voice/sounds.js'
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
import { installProfileCards, buildProfileCard } from './profileCard.js'
import { fetchFriends, sendFriendRequest, acceptFriend, declineFriend, removeFriend, blockUser, unblockUser } from '../data/friends.js'
import { fetchDmList, openDm, hideDm, dmSource, subscribeAllDmMessages, flushDmReads, resetDmReads } from '../data/dms.js'
import { subscribeUserEvents } from '../data/userEvents.js'
import { fetchMutedServers, muteServer, unmuteServer } from '../data/mutes.js'
import { fetchProfiles } from '../data/messages.js'
import { mentionsUser } from '../mentions.js'
import { shouldNotify, shouldNotifyCall, createNotifier, getNotifySettings, requestNotifyPermission, bildirimBasligi, bildirimMetni } from '../notify.js'
import { renderHomeSidebar, createFriendsPage, sortDms, dmUnreadTotal, kisiDurumu } from './home.js'

// Son seçilen sunucu/kanal tarayıcıda hatırlanır (sadece kolaylık için).
function sonuOku() {
  try { return JSON.parse(localStorage.getItem('voxen.last')) ?? {} } catch { return {} }
}
function sonuYaz(serverId, channelId) {
  try { localStorage.setItem('voxen.last', JSON.stringify({ serverId, channelId })) } catch { /* sorun değil */ }
}
// Son seçilen yer: 'ana' (Ana sayfa) ya da 'sunucu'. Açılışta buraya dönülür.
const YER_ANAHTARI = 'voxen.yer'
function yerOku() {
  try { return localStorage.getItem(YER_ANAHTARI) } catch { return null }
}
function yerYaz(yer) {
  try { localStorage.setItem(YER_ANAHTARI, yer) } catch { /* hatırlanmazsa sorun değil */ }
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

// Açık uygulamanın "aktif ses" işlemleri (aynı anda en fazla bir uygulama; bkz. startApp).
let aktifUygulama = null

// Tek aktif ses: sesli kanal YA DA DM araması (ikisi aynı anda olmaz, mikrofon bir kez açılır).
// Arama arayüzü (gelen arama kartı, arama paneli) bu işlemleri kullanır; testler de buradan sürer.
//   appVoice.aramayaGir(call, thread) -> aramanın sesli oturumu (uygulama kapalıysa null)
//     call: { id, ... } (data/calls.js startCall/answerCall dönüşü), thread: DM konuşması ({ id, other })
//     Sesli kanaldaysak önce oradan çıkılır ("Sesli kanaldan ayrıldın."); başka arama açıksa 'hangup' ile biter.
//   appVoice.aramadanCik(reason) -> aramanın oturumu kapanır (dm-voice: kanalı bırakılır, izler durur).
//     reason verilirse endCall(id, reason) da çağrılır; arama karşı tarafça zaten bittiyse null ver.
//     Dönen Promise endCall bitince çözülür (hata yutulur).
//   appVoice.aktifSes() -> null | { tur: 'kanal', oturum, channelId, serverId, channelName }
//                              | { tur: 'arama', oturum, call, thread }
export const appVoice = {
  aramayaGir: (call, thread) => aktifUygulama?.aramayaGir(call, thread) ?? null,
  aramadanCik: (reason) => aktifUygulama?.aramadanCik(reason) ?? Promise.resolve(),
  aktifSes: () => aktifUygulama?.aktifSes() ?? null,
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
  // Ana alan: üstte kanal başlığı, altında DM arama paneli (o DM açıkken) ve görüntü bölmesi
  // (sesli kanaldayken), en altta sohbet
  const baslikAlani = document.createElement('div')
  baslikAlani.className = 'header-host'
  const aramaAlani = document.createElement('div')
  aramaAlani.className = 'call-host'
  const goruntuAlani = document.createElement('div')
  goruntuAlani.className = 'video-host'
  const sohbetAlani = document.createElement('div')
  sohbetAlani.className = 'chat-host'
  main.append(baslikAlani, aramaAlani, goruntuAlani, sohbetAlani)
  // Sohbet başlığının sağındaki "Üyeler" düğmesi: tek düğme, her kanal açılışında başlığa taşınır
  const uyeDugmesi = createMemberToggle(uyePaneli)
  let goruntu = null // açık görüntü bölmesi (sesli kanaldayken)
  let uyeler = []
  let cubukDurumu = '' // çubuktaki durum satırının son çizilen hâli (bkz. cubukDurumunuYenile)
  let varlikHaritasi = new Map() // kim çevrimiçi: userId -> { status, statusText }
  // ---- Ana sayfa (arkadaşlar ve DM'ler) durumu ----
  // Varlık dinleyicisi hemen çağrılabildiği için burada (önce) tanımlanır.
  let anaSayfa = false // Ana sayfa mı açık (değilse bir sunucu)
  let anaGorunum = { tur: 'arkadaslar' } // orta alan: Arkadaşlar sayfası ya da { tur: 'dm', thread }
  let dmListesi = [] // fetchDmList(): son mesaja göre sıralı
  let arkadasVerisi = null // fetchFriends(): { friends, incoming, outgoing, blocked } (null: henüz gelmedi)
  let arkadasHatasi = false
  let arkadasSayfasi = null // createFriendsPage (bir kez kurulur; yazılan ad ve sekme kalır)
  let kullaniciOlaylari = null // subscribeUserEvents (kişi başına tek abonelik)
  let dmAboneligi = null // subscribeAllDmMessages kapatıcısı (kişi başına tek abonelik; DM sayısıyla artmaz)
  let dmKaynak = null // açık DM sohbetinin kaynağı (dmSource); DM açık değilse null
  let dmPaneli = false // sağ panel şu an DM profil kartını mı gösteriyor
  // Sessize alınan sunucular (hesapta saklanır, src/data/mutes.js): bahsetmeleri bildirim vermez, simge soluk
  let sessizSunucular = new Set()

  // Çevrimiçi durumu: giriş yapılınca başlar, Çıkış'ta durur. Tercihler tarayıcıda saklanır.
  aktifDurdur?.() // önceki startApp kalmışsa: izleyiciyi durdur + dinleyicisini bırak
  // Konuşma kapısı açıkken (oyunda bas-konuşla konuşurken fare/klavye Voxen'e gitmez) boşta sayılma
  let konusuyor = false
  const varlik = startPresence(profile.id, getLocalPresencePrefs, { isActive: () => konusuyor })
  let ses = null // açık sesli oturum (aynı anda en fazla bir sesli kanal)
  let arama = null // açık DM araması: { oturum, call, thread } (ses ile aynı anda olmaz; bkz. aktifSes)
  // ---- DM araması arayüzü (callPanel.js): 📞 düğmesi, DM'in üstündeki panel ve akış ----
  // Akış sesi app.js'in tek aktif ses işlemleriyle açar/kapatır (aramayaGir / aramadanCik).
  const aramaDugmesi = createCallButton({
    onClick: () => { if (anaSayfa && anaGorunum.tur === 'dm') aramaAkisi.baslat(anaGorunum.thread) },
  })
  const aramaPaneli = mountCallPanel(aramaAlani, {
    onCancel: () => aramaAkisi.iptal(),
    onHangup: () => aramaAkisi.kapat(),
    onToggleMute: () => susturmayiDegistir(),
    onToggleDeafen: () => sagirlastirmayiDegistir(),
  })
  const aramaAkisi = createCallFlow({
    startCall,
    endCall,
    pingCall,
    getCallStatus,
    enter: (call, thread) => aramayaGir(call, thread),
    exit: (reason) => aramadanCik(reason),
    // Arama başlarken sesli kanaldaysak önce oradan çıkılır; açık gelen arama kartı reddedilir
    // (karşılıklı aramada startCall o aramayı kabul etti: kart yalnız kapanır, reddedilmez)
    beforeStart: (call) => {
      if (gelenArama.acik() === call?.id) gelenArama.kapat(call.id)
      else gelenArama.reddet()
      if (!ses) return
      sesliAyril()
      toast('Sesli kanaldan ayrıldın.')
    },
    toast: (metin, tur) => toast(metin, tur),
    beep: (ad) => playBeep(ad),
    startTone: () => startLoop('bekleme'),
    onChange: () => aramaArayuzunuCiz(),
  })
  // 📞 düğmesinin durumu ve panel: panel yalnız aramanın DM'i açıkken görünür (başka yerde arama sürer)
  function aramaArayuzunuCiz() {
    if (durduruldu) return
    const bilgi = aramaAkisi.bilgi()
    const dm = anaSayfa && anaGorunum.tur === 'dm' ? anaGorunum.thread : null
    // "Aramadasın" yalnız aramadaki kişinin DM'inde; başka DM'de "Zaten bir aramadasın."
    const kabul = gelenArama.kabulEdiliyor() // gelen arama kabul ediliyor (answerCall sürüyor)
    const aramaKonusu = bilgi?.thread?.id ?? arama?.thread?.id ?? kabul?.thread?.id ?? null
    aramaDugmesi.update({
      canSend: dm?.canSend !== false,
      inCall: !!bilgi || !!arama || !!kabul,
      withPeer: !!dm && aramaKonusu === dm.id,
    })
    aramaPaneli.ciz(bilgi && dm && bilgi.thread?.id === dm.id ? aramaGorunumu(bilgi, profile) : null)
  }
  // ---- Gelen arama (incomingCall.js): sağ altta kart, zil ve masaüstü bildirimi ----
  const gelenArama = createIncomingCall({
    host: () => toastKutusunuAl(), // bildirim kutusunda, bildirimlerin üstünde
    answerCall,
    endCall,
    // Kabul edildi: sesli kanaldaysak oradan çıkılır (aramayaGir), konuşmaya geçilir ve DM açılır
    onAccept: (call, thread) => {
      if (durduruldu) { endCall(call.id, 'hangup').catch(() => {}); return }
      // Kabul sürerken başlamış bir giden arama varsa (📞 önce basıldı, startCall sonra döndü) iptal olur:
      // baglan endCall göndermez, iptal edilmezse o arama sunucuda sahipsiz kalırdı
      aramaAkisi.iptal()
      aramaAkisi.baglan(call, thread)
      openDmView(thread)
    },
    toast: (metin, tur) => toast(metin, tur),
    startRing: () => startLoop('zil'),
    onChange: () => aramaArayuzunuCiz(), // kabul sürerken 📞 pasif
  })
  const gelenBekleyen = new Set() // konuşması aranırken (liste tazelenirken) bekleyen gelen aramalar
  // Meşgul miyiz: aramadayız ya da birini arıyoruz (ya da başka bir gelen arama kartı açık)
  // Kabul et'e basılıp answerCall beklenirken de meşgulüz (kart kapandı ama arama henüz açılmadı).
  function aramadaMesgul(ev) {
    return !!arama || !!aramaAkisi.bilgi() || !!gelenArama.kabulEdiliyor() ||
      (gelenArama.acik() != null && gelenArama.acik() !== ev.callId)
  }
  // 'ringing': başkasından gelen arama. Meşgulsek kart çıkmadan reddedilir.
  async function gelenAramaGeldi(ev) {
    if (ev.caller === profile.id) return // kendi aramamız (tetikleyici iki tarafa da gönderir)
    if (gelenArama.acik() === ev.callId || gelenBekleyen.has(ev.callId)) return // aynı olay iki kez
    // Aynı kişiyi biz de arıyoruz (karşılıklı arama): sunucu iki aramayı birleştirir, kart gösterilmez
    if (aramaAkisi.bilgi()?.thread?.id === ev.threadId) return
    if (aramadaMesgul(ev)) { endCall(ev.callId, 'decline').catch(() => {}); return }
    gelenBekleyen.add(ev.callId)
    // Konuşma listede yoksa (yeni ya da gizlenmiş) önce liste tazelenir: arayanın adı ve avatarı için
    let thread = dmListesi.find((t) => t.id === ev.threadId)
    if (!thread) {
      try { await sosyalTazele() } catch { /* liste alınamadı: yedek ad */ }
      thread = dmListesi.find((t) => t.id === ev.threadId)
    }
    if (!gelenBekleyen.delete(ev.callId) || durduruldu) return // beklerken arama bitti
    if (aramadaMesgul(ev)) { endCall(ev.callId, 'decline').catch(() => {}); return }
    thread ??= {
      id: ev.threadId,
      other: { id: ev.caller, username: GELEN_ARAMA_METINLERI.bilinmeyen, color: null, avatar_url: null },
      createdAt: null,
      lastMessageAt: null,
      unread: 0,
      canSend: true,
    }
    const durum = bildirimDurumu()
    const ayarlar = getNotifySettings()
    if (!gelenArama.goster({ callId: ev.callId, thread, zil: zilCalsinMi({ durum, ayarlar }) })) return
    if (shouldNotifyCall({ odakta: pencereOdakta(), durum, ayarlar })) {
      const kapat = bildirimci.bildirArama({ id: ev.callId, ad: thread.other?.username ?? GELEN_ARAMA_METINLERI.bilinmeyen })
      gelenArama.bildirimEkle(ev.callId, kapat) // kart kapanınca bildirim de kalkar
    }
  }

  // "user:<uid>" konusundaki "arama" olayları: TEK giriş noktası.
  //  - 'ringing': gelen arama kartı (gelenAramaGeldi; yük caller === profile.id ise kendi aramamızdır)
  //  - 'active' / 'ended': arayanın "Aranıyor…" ve konuşma akışı (callPanel.js createCallFlow.olay);
  //    aranan tarafta kart kapanır (arama bitti ya da başka penceremizde cevaplandı)
  function aramaOlayi(payload) {
    if (durduruldu) return
    const ev = parseCallEvent(payload)
    if (!ev) return
    if (ev.status === 'ringing') { gelenAramaGeldi(ev); return }
    gelenBekleyen.delete(ev.callId)
    gelenArama.kapat(ev.callId)
    aramaAkisi.olay(ev)
    // Akışın bilmediği açık arama (ör. doğrudan appVoice ile girildi) karşı tarafça bittiyse yerelde kapat
    if (ev.status === 'ended' && arama?.call.id === ev.callId) aramadanCik(null)
  }
  let sesKanalAdi = ''
  let sesSunucuId = null // sesli kanalımızın sunucusu (başka sunucuya bakarken de bilinsin)
  // Sesli kanalımızın sunucusunun üyeleri: katılırken alınır, yalnız o sunucunun üyeleri yeniden
  // yüklenince yenilenir. Başka sunucuya bakarken (uyeler o sunucunun olur) görüntü bölmesi boşalmasın.
  let sesUyeleri = []
  let ilkCizimYapildi = false
  let eskiSatirBakildi = false
  let benimPencerelerim = new Set() // varlıkta en son gördüğümüz kendi pencerelerimiz (clientId)
  const dusenZamanlayicilar = new Map() // düşen pencere clientId -> silme zamanlayıcısı
  // DM'deki kişinin en son çizilen durumu: varlık olayları sık gelir; DM başlığındaki nokta ve sağdaki
  // profil kartı yalnız o kişinin durumu gerçekten değişince yeniden çizilir.
  let dmKisiIzi = null
  const dinlemeyiBirak = onPresenceChange((harita) => {
    varlikHaritasi = harita
    cubukDurumunuYenile()
    eskiSatiriTemizle()
    dusenPencereleriTemizle()
    odadakiEkraniBildir() // ekran paylaşan çevrimdışı olduysa kural kalkar
    const dmAcik = anaSayfa && anaGorunum.tur === 'dm'
    const dmKisi = dmKaynak?.other ?? (dmAcik ? anaGorunum.thread.other : null)
    const iz = dmKisi ? dmKisiIziHesapla(dmKisi) : null
    const dmKisiDegisti = iz !== dmKisiIzi
    dmKisiIzi = iz
    if (!dmAcik || dmKisiDegisti) cizUyeler()
    if (anaSayfa) arkadasSayfasiniGuncelle() // satırlardaki durum noktası/yazısı ve Çevrimiçi sekmesi
    if (dmKaynak && dmKisiDegisti) sohbet?.setPeerStatus(kisiDurumu(harita, dmKaynak.other?.id)) // DM başlığındaki nokta
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
    getLevel: () => aktifOturum()?.getLevel() ?? 0,
    onGate: (acik) => {
      const o = aktifOturum()
      o?.setTransmitting(acik)
      konusuyor = acik
      if (acik) varlik.activity() // konuşmaya başladı: boştaysa hemen çevrimiçi ol
      // Bip sadece bas-konuş modunda, susturulmamış/sağır değilken çalar
      if (o) {
        const bip = pttBeepName(acik, { mode: getSettings().mode, ...o.getState() })
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
    const o = aktifOturum() // sesli kanal ya da arama: ayarlar ikisinde de aynen geçerli
    o?.setNoiseSuppression(s.noiseSuppression)
    o?.setBitrate(s.bitrateKbps)
    o?.setUploadMbps(s.uploadMbps)
    o?.setOutputDevice(s.outputDeviceId)
    // Kamera seçimi değişti ve kamera açıksa canlı geçir (mikrofondan farklı olarak)
    if (s.cameraDeviceId !== sonKameraCihazi) { sonKameraCihazi = s.cameraDeviceId; o?.switchCamera() }
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
        isInVoice: () => !!aktifOturum(),
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
  // Tek durum: sesli kanalda ya da aramadaysak aktif oturumun durumu; değilsek kayıtlı tercih
  // (getSettings().muted/deafened) ve bir sonraki katılışta oturum bu tercihle başlar.
  // Kanaldayken/aramadayken de son seçim tercihe yazılır ki sonraki katılışta aynı kalsın.
  function susturmayiDegistir() {
    const o = aktifOturum()
    // Sağırken Sustur'a basmak sağırlığı da kaldırır (Discord gibi): simge boşuna çizili kalmasın
    const simdi = o ? o.getState() : getSettings()
    if (simdi.deafened && !simdi.listenOnly) {
      if (o) {
        o.setMuted(false)
        o.setDeafened(false)
        updateSettings({ muted: false, deafened: false })
      } else {
        updateSettings({ muted: false, deafened: false })
        cizKanalPaneli()
      }
      return
    }
    if (o) {
      if (o.getState().listenOnly) return // mikrofon yok: hep susturulmuş, tercih bozulmasın
      o.toggleMute() // 'change' olayı: panel yeniden çizilir (kanaldaysak voice_states'e de yazılır)
      updateSettings({ muted: o.getState().muted })
    } else {
      updateSettings({ muted: !getSettings().muted })
      cizKanalPaneli()
    }
  }
  function sagirlastirmayiDegistir() {
    const o = aktifOturum()
    if (o) {
      o.toggleDeafen()
      updateSettings({ deafened: o.getState().deafened })
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
  // Sayfa kapanırken sesli kanaldan ya da aramadan ayrıl (karşıdakilere bye gider)
  const sayfaKapaniyor = () => {
    sesliAyril(false, { hemen: true })
    aramaAkisi.iptal() // "Aranıyor…" iken: arama iptal
    aramadanCik('hangup', { ciz: false })
  }
  window.addEventListener('pagehide', sayfaKapaniyor)
  function varligiDurdur() {
    sesliAyril(false, { hemen: true })
    aramaAkisi.iptal() // "Aranıyor…" iken: arama iptal (sayaç ve bekleme tonu durur)
    aramadanCik('hangup', { ciz: false })
    aramaPaneli.ciz(null)
    gelenArama.destroy() // kart kapanır, zil ve 30 sn sayacı durur
    gelenBekleyen.clear()
    sesAbonelikleriniKapat()
    for (const z of dusenZamanlayicilar.values()) clearTimeout(z)
    dusenZamanlayicilar.clear()
    window.removeEventListener('pagehide', sayfaKapaniyor)
    profilKartlariniBirak()
    dinlemeyiBirak()
    window.removeEventListener('focus', pencereOdaga)
    olaylar?.close()
    olaylar = null
    kullaniciOlaylari?.close()
    kullaniciOlaylari = null
    dmAboneligi?.()
    dmAboneligi = null
    bildirimci.destroy()
    // Açık sohbet kapanır: mesaj aboneliği ve "yazıyor" kanalı (yoksa aynı sekmede yeniden girişte
    // eski kanal nesnesi kalır, yeni abonelik bağlanmaz ve "yazıyor…" gitmez)
    sohbet?.destroy()
    sohbet = null
    dmKaynak = null
    acikSohbetId = null
    okunmamis.destroy()
    document.removeEventListener('visibilitychange', okunduIsaretle)
    // Bekleyen işaretler gönderi listesine eşzamanlı kopyalanır; hemen sıfırlamak güvenli (sonraki hesaba sızmaz, yarış yok)
    flushReads().catch(() => {})
    resetReads()
    flushDmReads().catch(() => {})
    resetDmReads()
    setWindowTitle(baslikYazisi(0))
    closeMenu()
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
    if (aktifUygulama === buUygulama) aktifUygulama = null
  }
  aktifDurdur = varligiDurdur
  const buUygulama = { aramayaGir, aramadanCik, aktifSes }
  aktifUygulama = buUygulama

  // Çıkış yap (Ayarlar > Hesap'taki kırmızı düğme). Sıra önemli:
  // önce varlık ve ses durdurulur, sesli durum satırı silinir, EN SON oturum kapanır.
  async function cikisYap() {
    varligiDurdur()
    // Önce sesli durum satırımız silinsin (oturum kapanınca silme yetkimiz kalmaz); ağ yoksa en fazla 3 sn
    await Promise.race([flushVoiceStates(), new Promise((r) => setTimeout(r, CIKIS_BEKLEME_MS))])
    signOut()
  }
  // (renderMemberList .sunucusuz sınıfını korur; sınıfı sagPaneliAyarla koyar/kaldırır. Burada sunucuId'ye
  //  bakılmaz: bu fonksiyon varlık dinleyicisi kurulurken, sunucuId tanımlanmadan önce de çağrılır.)
  // DM açıkken panelde üye listesi yerine karşı tarafın profil kartı durur (bkz. cizDmProfili).
  function cizUyeler() {
    if (anaSayfa && anaGorunum.tur === 'dm') { cizDmProfili(); return }
    renderMemberList(uyePaneli, { members: uyeler, presence: varlikHaritasi })
  }

  // DM'de sağ panel: karşı tarafın profil kartı (açılır kartla aynı çizim; geniş pencerede görünür,
  // dar pencerede CSS gizler). "Mesaj gönder" yok: zaten bu konuşmadayız.
  function cizDmProfili() {
    const kisi = anaGorunum.thread.other
    const bilgi = profilBilgisi(kisi)
    dmKisiIzi = dmKisiIziHesapla(kisi) // şimdiki durumla çizildi (başlık da açılışta bununla kurulur)
    if (bilgi.social) bilgi.social = { ...bilgi.social, canMessage: false }
    const kart = buildProfileCard({ person: kisi, ...bilgi })
    kart.classList.add('dm-profile-card')
    uyePaneli.replaceChildren(kart)
  }

  // DM'deki kişinin kartta görünen durum bilgisi (karşılaştırma için tek metin)
  function dmKisiIziHesapla(kisi) {
    const b = profilBilgisi(kisi)
    return JSON.stringify([kisi.id, b.status, b.statusText, b.voiceChannelName])
  }

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
    if (kisi.id !== profile.id) bilgi.social = sosyalKartBilgisi(kisi)
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

  // Kartta arkadaşlık/mesaj düğmeleri. "Mesaj gönder": arkadaşa ve sunucu arkadaşına (kart bir sunucunun
  // üye listesinden ya da mesajından açıldıysa ortak sunucu var demektir). Engellediğim kişide düğme yok.
  function sosyalKartBilgisi(kisi) {
    const v = arkadasVerisi
    const listede = (ad) => !!v?.[ad]?.some((p) => p.id === kisi.id)
    if (listede('blocked')) return null
    const arkadas = listede('friends')
    const sunucuArkadasi = uyeler.some((u) => u.id === kisi.id) || sesUyeleri.some((u) => u.id === kisi.id)
    return {
      friend: !v ? null : arkadas ? 'friend' : listede('outgoing') ? 'outgoing' : 'none',
      canMessage: arkadas || sunucuArkadasi,
      onAdd: async () => {
        const r = await sendFriendRequest(kisi.username)
        sosyalTazele()
        return r
      },
      onMessage: () => kisiyleDmAc(kisi),
    }
  }

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
        if (!anaSayfa) sohbet?.setMembers(liste) // @ önerisi ve @ad etiketleri
        cizUyeler()
        cizKanalPaneli() // sesli kanaldaki kişiler de üye listesinden gelir
        goruntu?.update()
      })
      .catch(() => { /* sessizce geç: bir sonraki varlık değişiminde tekrar denenir */ })
      .finally(() => { uyeYukleniyor = false })
  }
  let servers = []
  let olaylar = null // sunucu olayları aboneliği (bkz. sunucuOlaylariniAyarla)
  let kanallar = []
  let sunucuId = null
  let kanalId = null // panelde vurgulanan kanal (sesli de olabilir)
  let yaziliId = null // sohbeti açık olan yazılı kanal
  let sohbet = null // açık sohbet (destroy() ile kapatılır)
  let acikSohbetId = null // cizMain: hangi sohbet/kart açık (kanal id'si, 'karsilama' ya da 'hata'); okunmamış sayacı da okur
  // Okunmamış sayacı (bkz. unread.js): tek abonelikle bütün kanalları dinler; çıkışta/durdurmada kapanır.
  const pencereOdakta = () => document.visibilityState !== 'hidden' && document.hasFocus()
  const okunmamis = createUnreadTracker({
    profileId: profile.id,
    getUsername: () => profile.username, // @bahsetme sayısı (ad değişebilir)
    getReading: () => (sohbet && acikSohbetId ? { channelId: acikSohbetId, atBottom: sohbet.isAtBottom() } : null),
    isFocused: pencereOdakta,
    onMessage: (m, serverId) => kanalMesajiGeldi(m, serverId), // @bahsetme bildirimi (aynı tek abonelik)
    onChange: () => {
      if (durduruldu) return
      basligiGuncelle()
      if (!ilkCizimYapildi) return // henüz çizim yok: ilk çizim sayıları zaten okur
      cizSerit()
      cizKanalPaneli()
    },
  })
  // Pencere başlığı "(N) Voxen": kanal okunmamışları + DM okunmamışları
  function basligiGuncelle() {
    setWindowTitle(baslikYazisi(okunmamis.total() + dmUnreadTotal(dmListesi)))
  }
  // Açık kanal ya da DM okundu sayılır: pencere odakta ve en alttaysa (açılınca, en alta inince, odağa gelince)
  function okunduIsaretle() {
    if (durduruldu || !sohbet || !acikSohbetId || !pencereOdakta() || !sohbet.isAtBottom()) return
    if (dmKaynak) { dmOkunduSay(); return }
    okunmamis.markChannelRead(acikSohbetId, sohbet.getLastId())
  }
  // Açık DM şu an okunuyor mu (bu konuşma açık, pencere odakta, en altta)
  function dmOkunuyor(threadId) {
    return !!dmKaynak && dmKaynak.id === threadId && !!sohbet && pencereOdakta() && sohbet.isAtBottom()
  }
  // Açık DM'i okundu işaretler (gecikmeli yazılır) ve satırdaki sayıyı hemen sıfırlar
  function dmOkunduSay() {
    const son = sohbet.getLastId()
    if (son != null) dmKaynak.markRead(son)
    const id = dmKaynak.id
    if (!dmListesi.some((t) => t.id === id && t.unread > 0)) return
    dmListesi = dmListesi.map((t) => (t.id === id ? { ...t, unread: 0 } : t))
    dmSayilariDegisti()
  }
  // DM sayıları değişti: başlık, şeritteki Ana sayfa rozeti ve (Ana sayfadaysak) sol sütun
  function dmSayilariDegisti() {
    basligiGuncelle()
    if (!ilkCizimYapildi) return
    cizSerit()
    if (anaSayfa) cizKanalPaneli()
  }

  // ---- DM sayaç aboneliği (bütün DM'ler, tek abonelik; bkz. subscribeAllDmMessages) ----
  // Yeni DM mesajı: konuşmanın sayısı (okunmuyorsa) artar, liste son mesaja göre yeniden sıralanır.
  // Masaüstü bildirimleri de bu tek noktaya bağlıdır (dmBildirimi).
  function dmMesajiGeldi(m) {
    if (durduruldu) return
    const t = dmListesi.find((x) => x.id === m.thread_id)
    if (!t) {
      // Yeni ya da gizlenmiş konuşma: listede yeniden görünsün; gelince bildirimi de gösterilir
      sosyalTazele().then(() => {
        const yeni = dmListesi.find((x) => x.id === m.thread_id)
        if (yeni) dmBildirimi(m, yeni)
      }).catch(() => { /* liste alınamadı: bildirim gösterilmez */ })
      return
    }
    dmBildirimi(m, t)
    const artir = m.author_id !== profile.id && !dmOkunuyor(t.id) // kendi mesajım ve okunan DM sayılmaz
    dmListesi = sortDms(dmListesi.map((x) => (x.id === t.id
      ? { ...x, lastMessageAt: m.created_at ?? x.lastMessageAt, unread: artir ? (x.unread > 0 ? x.unread : 0) + 1 : x.unread }
      : x)))
    dmSayilariDegisti()
  }
  // Düzenleme/silme: başkasının mesajı silindiyse okunmamış sayısı düşebilir; sunucudan yeniden al
  function dmMesajiDegisti(m) {
    if (durduruldu) return
    if (m.deleted_at && m.author_id !== profile.id) sosyalTazele()
  }
  document.addEventListener('visibilitychange', okunduIsaretle)

  // ---- Masaüstü bildirimleri (src/notify.js) ----
  // Kararı shouldNotify verir; yeni abonelik açılmaz: DM'ler dmMesajiGeldi'den, kanal mesajları
  // okunmamış sayacının tek aboneliğinden (onMessage) gelir.
  const bildirimci = createNotifier({ ac: bildirimHedefiniAc })
  // Şu an açık konuşma: DM'de konuşma id'si, sunucuda açık yazılı kanalın id'si
  function acikHedef() {
    if (dmKaynak) return dmKaynak.id
    return !anaSayfa && sohbet ? acikSohbetId : null
  }
  // Kendi durumum: Rahatsız etmeyin bu penceredeki tercihten ya da (başka penceremde seçildiyse) varlıktan
  function bildirimDurumu() {
    return getLocalPresencePrefs().dnd ? 'dnd' : benimDurumum()
  }
  function bildirimGelsinMi(msg, tur) {
    return shouldNotify({
      msg,
      selfId: profile.id,
      odakta: pencereOdakta(),
      acikHedef: acikHedef(),
      durum: bildirimDurumu(),
      sessizSunucular,
      ayarlar: getNotifySettings(),
      tur,
    })
  }
  // DM: başlık karşı tarafın adı
  function dmBildirimi(m, thread) {
    if (durduruldu || !bildirimGelsinMi(m, 'dm')) return
    const ad = thread.other?.username ?? ''
    bildirimci.bildir({
      hedef: { type: 'dm', id: thread.id },
      ad,
      baslik: bildirimBasligi({ tur: 'dm', ad }),
      metin: bildirimMetni(m.content),
    })
  }
  // Sunucu mesajı beni anıyorsa: başlık "Ad (#kanal, Sunucu)". Kanal ve yazar elimizde yoksa (başka
  // sunucu) veritabanından alınır; yalnız beni anan mesajlarda (seyrek) sorgu atılır.
  async function kanalMesajiGeldi(m, serverId) {
    if (durduruldu || !mentionsUser(m.content, profile.username)) return
    let kanal = kanallar.find((k) => k.id === m.channel_id) ?? null
    if (kanal) serverId = sunucuId
    // Ucuz ön denetim (sunucu biliniyorsa sessiz kuralı dahil); sorgudan sonra yeniden bakılır
    if (!bildirimGelsinMi({ ...m, server_id: serverId }, 'mention')) return
    try {
      if (!kanal) kanal = await getChannel(m.channel_id)
      if (!kanal) return
      serverId = kanal.server_id ?? serverId
      const yazar = uyeler.find((u) => u.id === m.author_id) ?? (await fetchProfiles([m.author_id]))[0]
      const sunucu = servers.find((s) => s.id === serverId)
      if (durduruldu || !yazar || !sunucu) return
      if (!bildirimGelsinMi({ ...m, server_id: serverId }, 'mention')) return // beklerken durum değişmiş olabilir
      bildirimci.bildir({
        hedef: { type: 'mention', id: m.channel_id, serverId },
        ad: yazar.username,
        baslik: bildirimBasligi({ tur: 'mention', ad: yazar.username, kanal: kanal.name, sunucu: sunucu.name }),
        metin: bildirimMetni(m.content),
      })
    } catch { /* bilgi alınamadı: bildirim gösterilmez, okunmamış sayacı yine çalışır */ }
  }
  // Bildirime tıklandı (pencere öne getirildi): DM'i ya da bahsedilen kanalı aç
  function bildirimHedefiniAc(hedef) {
    if (durduruldu || !hedef?.id) return
    // Gelen arama: pencere öne geldi; kart (hâlâ çalıyorsa) zaten sağ altta görünür, kabul karttan yapılır
    if (hedef.type === 'call') return
    if (hedef.type === 'dm') {
      const thread = dmListesi.find((t) => t.id === hedef.id)
      if (thread) { openDmView(thread); return }
      // Listede yok (yeni ya da gizlenmiş konuşma): liste tazelenince bir kez daha denenir
      sosyalTazele().then(() => {
        if (durduruldu) return
        const yeni = dmListesi.find((t) => t.id === hedef.id)
        if (yeni) openDmView(yeni)
      }).catch(() => { /* liste alınamadı: açılmaz */ })
      return
    }
    if (hedef.type !== 'mention' || !servers.some((s) => s.id === hedef.serverId)) return
    if (!anaSayfa && sunucuId === hedef.serverId && kanallar.some((k) => k.id === hedef.id)) kanalSec(hedef.id)
    else sunucuSec(hedef.serverId, hedef.id)
  }

  // ---- Sunucuyu sessize alma (hesapta saklanır: her cihazda geçerli) ----
  function sessizleriYukle() {
    return fetchMutedServers()
      .then((liste) => {
        if (durduruldu) return
        const degisti = liste.size !== sessizSunucular.size || [...liste].some((id) => !sessizSunucular.has(id))
        sessizSunucular = liste
        if (degisti && ilkCizimYapildi) cizSerit()
      })
      .catch(() => { /* alınamadı: eski liste kalır, odağa gelince yeniden denenir */ })
  }
  // Hata olursa toast gösterir ve fırlatır (Ayarlar'daki "Sesi aç" düğmesi yeniden açılsın diye)
  async function sessizeAl(id, sessiz) {
    try {
      if (sessiz) await muteServer(id)
      else await unmuteServer(id)
    } catch (e) {
      toast(hataMetni(e), 'hata')
      throw e
    }
    if (durduruldu) return
    sessizSunucular = new Set(sessizSunucular)
    if (sessiz) sessizSunucular.add(id)
    else sessizSunucular.delete(id)
    cizSerit()
  }

  // Sunucu listesi durumu: 'yukleniyor' | 'hazir' | 'hata'. Karşılama kartı yalnız liste GERÇEKTEN
  // boş geldiyse çıkar (yüklenemediyse "yeni kullanıcı" sanmayalım).
  let sunucuDurumu = 'yukleniyor'
  let davetIsleniyor = false // adresteki davetle katılırken kart bir anlığına yanıp sönmesin

  // Sunucu listesini yükler; başarılıysa durum 'hazir' olur. Hata olursa fırlatır.
  async function sunuculariYukle() {
    servers = await listMyServers()
    sunucuDurumu = 'hazir'
    sunucuOlaylariniAyarla()
  }

  // Sunucu olayları (silme, ad değişimi, kanal ekleme/silme, ayrılma): üyesi olduğumuz her sunucunun
  // konusu dinlenir; sunucu listesi değişince abonelikler de güncellenir.
  function sunucuOlaylariniAyarla() {
    if (durduruldu) return
    const idler = servers.map((s) => s.id)
    if (olaylar) olaylar.update(idler)
    else olaylar = subscribeServerEvents(idler, sunucuOlayi)
  }

  // Ana alan: sohbet her zaman SON SEÇİLEN YAZILI kanalı gösterir (sesli kanala tıklamak onu değiştirmez).
  // Aynı kanal zaten açıksa yeniden kurmayız; değişince eski sohbetin aboneliği kapatılır.
  // Hiç sunucu yoksa sohbet yerine karşılama kartı çizilir (acikSohbetId = 'karsilama');
  // sunucular yüklenemediyse hata kutusu ve "Yeniden dene" (acikSohbetId = 'hata').
  function cizMain() {
    if (anaSayfa) { cizAnaSayfaMain(); return }
    const kanal = kanallar.find((k) => k.id === yaziliId && k.kind === 'text')
    let anahtar = kanal?.id ?? null
    if (sunucuDurumu === 'hata') anahtar = 'hata'
    else if (sunucuDurumu === 'hazir' && servers.length === 0 && !davetIsleniyor) anahtar = 'karsilama'
    if (anahtar === acikSohbetId) return
    sohbet?.destroy()
    sohbet = null
    dmKaynak = null
    acikSohbetId = anahtar
    sohbetAlani.innerHTML = ''
    baslikAlani.innerHTML = ''
    if (anahtar === 'karsilama') {
      // Düğmeler şeritteki + ve zincir düğmeleriyle aynı pencereleri açar
      sohbetAlani.appendChild(renderWelcome(profile, { onCreate: sunucuOlustur, onJoin: sunucuyaKatil }))
    } else if (anahtar === 'hata') {
      sohbetAlani.appendChild(renderLoadError('Sunucular yüklenemedi. Bağlantını kontrol edip yeniden dene.', yenidenDene))
    } else if (kanal) {
      sohbet = mountChat(sohbetAlani, { channel: kanal, profile, isOwner: servers.find((s) => s.id === sunucuId)?.owner_id === profile.id, headerActions: [uyeDugmesi.button], headerHost: baslikAlani, onBottom: () => okunduIsaretle(), members: uyeSunucusu === sunucuId ? uyeler : [] })
    }
  }

  const railHandlers = { onSelect: (id) => sunucuSec(id), onAdd: () => sunucuOlustur(), onJoin: () => sunucuyaKatil(), onHome: () => anaSayfayaGec({ tur: 'arkadaslar' }) }
  // Şerit: en üstte Ana sayfa (rozet: okunmamış DM toplamı), sonra sunucular
  function cizSerit() {
    renderRail(rail, servers, anaSayfa ? null : sunucuId, railHandlers, okunmamis, { selected: anaSayfa, unread: dmUnreadTotal(dmListesi) }, sessizSunucular)
  }
  function cizHepsi() {
    sagPaneliAyarla()
    cizSerit()
    cizKanalPaneli()
    cizMain()
    aramaArayuzunuCiz() // DM'e girilince/çıkılınca panel görünür/gizlenir
  }

  // Sağ panel: sunucudayken üye listesi; DM'de karşı tarafın profil kartı; başka yerde gizli.
  // Sunucu yokken (ya da Arkadaşlar sayfasındayken) üye paneli boş kalırdı: gizle (CSS .sunucusuz).
  // DM'de "Üyeler" düğmesi yok: panel her zaman açılır (dar pencerede CSS gizler); DM'den çıkınca
  // panel kullanıcının Üyeler seçimine döner.
  function sagPaneliAyarla() {
    const dm = anaSayfa && anaGorunum.tur === 'dm'
    uyePaneli.classList.toggle('sunucusuz', !sunucuId && !dm)
    uyePaneli.classList.toggle('dm-profil', dm)
    if (dm === dmPaneli) return
    dmPaneli = dm
    if (dm) uyePaneli.hidden = false
    else {
      uyeDugmesi.refresh()
      cizUyeler() // DM profil kartı kalmasın: panel üye listesiyle (ya da boş) yeniden çizilir
    }
  }

  // ---- Ana sayfa: Arkadaşlar sayfası ve DM'ler ----

  // Ana sayfaya geçer (gorunum verilirse orta alan ona döner). Bakılan sunucu bırakılır: üyeleri ve
  // sesli durum aboneliği kapanır (sesli kanaldaysak o sunucunun aboneliği kalır, ses sürer).
  function anaSayfayaGec(gorunum = null) {
    if (gorunum) anaGorunum = gorunum
    if (!anaSayfa) {
      anaSayfa = true
      sunucuId = null
      kanallar = []
      kanalId = null
      yaziliId = null
      uyeler = []
      uyeSunucusu = null
      sesAbonelikleriniAyarla()
    }
    yerYaz('ana')
    cizHepsi()
    cizUyeler()
  }

  // DM görünümünü açar (DM açmanın tek yolu): orta alanda sohbet, sağda karşı tarafın profil kartı.
  // thread: fetchDmList() satırı ya da en az { id, other: { id, username, color, avatar_url } }.
  // Engelli konuşma (canSend false) yalnız DM listesindeki satırdan açılır: eski mesajlar görünür, kutu kapalı.
  function openDmView(thread) {
    requestNotifyPermission() // tarayıcıda bildirim izni ilk DM açılınca bir kez sorulur
    anaSayfayaGec({ tur: 'dm', thread })
  }

  // 💬 / "Mesaj gönder": konuşmayı açar (yoksa oluşturur), sonra DM görünümüne geçer
  async function kisiyleDmAc(kisi) {
    let id
    try { id = await openDm(kisi.id) } catch (e) { toast(e?.message || ISLEM_BASARISIZ, 'hata'); return }
    if (durduruldu) return
    const thread = dmListesi.find((t) => t.id === id) ?? {
      id,
      other: { id: kisi.id, username: kisi.username, color: kisi.color ?? null, avatar_url: kisi.avatar_url ?? null },
      createdAt: null,
      lastMessageAt: null,
      unread: 0,
      canSend: true,
    }
    openDmView(thread)
    sosyalTazele() // yeni (ya da gizlenmiş) konuşma listede görünsün
  }

  // × : DM listeden gizlenir; açıksa Arkadaşlar sayfasına dönülür
  async function dmGizle(thread) {
    try { await hideDm(thread.id) } catch (e) { toast(e?.message || ISLEM_BASARISIZ, 'hata'); return }
    if (durduruldu) return
    dmListesi = dmListesi.filter((t) => t.id !== thread.id)
    if (anaGorunum.tur === 'dm' && anaGorunum.thread.id === thread.id) anaGorunum = { tur: 'arkadaslar' }
    if (anaSayfa) cizHepsi()
    else cizSerit()
    sosyalTazele()
  }

  // Satır düğmeleri: iş bitince listeler yeniden alınır; hata toast ile söylenir
  function arkadasIsi(is) {
    return async (kisi) => {
      try { await is(kisi.id) } catch (e) { toast(e?.message || ISLEM_BASARISIZ, 'hata') }
      sosyalTazele()
    }
  }
  function arkadasSayfasiniAl() {
    if (!arkadasSayfasi) {
      arkadasSayfasi = createFriendsPage({
        handlers: {
          onMessage: (kisi) => kisiyleDmAc(kisi),
          onSend: async (ad) => {
            const r = await sendFriendRequest(ad)
            sosyalTazele()
            return r
          },
          onAccept: arkadasIsi(acceptFriend),
          onDecline: arkadasIsi(declineFriend),
          onUnblock: arkadasIsi(unblockUser),
          // Onay penceresi hatayı kendisi gösterir: burada fırlatılır
          onRemove: async (kisi) => { await removeFriend(kisi.id); sosyalTazele() },
          onBlock: async (kisi) => { await blockUser(kisi.id); sosyalTazele() },
        },
      })
    }
    return arkadasSayfasi
  }
  function arkadasSayfasiniGuncelle() {
    if (!arkadasSayfasi) return
    const v = arkadasVerisi
    arkadasSayfasi.update({
      friends: v?.friends ?? null,
      incoming: v?.incoming ?? [],
      outgoing: v?.outgoing ?? [],
      blocked: v?.blocked ?? [],
      presence: varlikHaritasi,
      error: arkadasHatasi,
    })
  }

  // Ana sayfanın orta alanı: Arkadaşlar sayfası ya da DM sohbeti (kanal sohbetiyle aynı ekran, dmSource ile)
  function cizAnaSayfaMain() {
    const anahtar = anaGorunum.tur === 'dm' ? `dm:${anaGorunum.thread.id}` : 'arkadaslar'
    if (anahtar === acikSohbetId) return
    sohbet?.destroy()
    sohbet = null
    dmKaynak = null
    acikSohbetId = anahtar
    sohbetAlani.innerHTML = ''
    baslikAlani.innerHTML = ''
    if (anaGorunum.tur === 'dm') {
      const thread = anaGorunum.thread
      dmKaynak = dmSource(thread, profile)
      sohbet = mountChat(sohbetAlani, {
        source: dmKaynak,
        profile,
        headerHost: baslikAlani,
        peerStatus: kisiDurumu(varlikHaritasi, thread.other?.id),
        onBottom: () => okunduIsaretle(),
        headerActions: [aramaDugmesi.button], // 📞 Sesli arama başlat
      })
    } else {
      const sayfa = arkadasSayfasiniAl()
      arkadasSayfasiniGuncelle() // Ana sayfa dışındayken güncellenmedi: son veriyle çiz
      baslikAlani.appendChild(sayfa.header)
      sohbetAlani.appendChild(sayfa.body)
    }
  }

  // Ana sayfanın sol sütunu (kanal panelinin içinde, kullanıcı çubuğunun üstünde)
  function anaSayfaSolSutun() {
    return renderHomeSidebar({
      dms: dmListesi,
      presence: varlikHaritasi,
      view: anaGorunum,
      pending: arkadasVerisi?.incoming?.length ?? 0,
      handlers: {
        onFriends: () => anaSayfayaGec({ tur: 'arkadaslar' }),
        onOpenDm: (thread) => openDmView(thread),
        onHideDm: (thread) => dmGizle(thread),
      },
    })
  }

  // Arkadaş ve DM listelerini yeniden alır (açılışta, kişi olayı gelince, pencere odağa gelince).
  // Aynı anda tek iş; çalışırken gelen istekler tek bir ek turda birleşir.
  let sosyalIsi = null
  let sosyalIstendi = false
  function sosyalTazele() {
    sosyalIstendi = true
    if (!sosyalIsi) {
      sosyalIsi = (async () => {
        try {
          while (sosyalIstendi && !durduruldu) {
            sosyalIstendi = false
            await sosyalTek()
          }
        } finally { sosyalIsi = null }
      })()
    }
    return sosyalIsi
  }
  async function sosyalTek() {
    const [dm, ark] = await Promise.allSettled([fetchDmList(), fetchFriends(profile.id)])
    if (durduruldu) return
    let dmYenidenKur = false
    if (dm.status === 'fulfilled') {
      dmListesi = sortDms(dm.value)
      // Açık ve okunan DM'in işareti henüz yazılmamış olabilir: sunucudaki eski sayıyı gösterme
      if (dmKaynak && dmOkunuyor(dmKaynak.id)) dmListesi = dmListesi.map((t) => (t.id === dmKaynak.id ? { ...t, unread: 0 } : t))
      // Açık DM'de engel durumu değiştiyse (engellendi / kaldırıldı) sohbet yeni duruma göre yeniden kurulur
      const acikDm = anaGorunum.tur === 'dm' ? dmListesi.find((t) => t.id === anaGorunum.thread.id) : null
      if (acikDm) {
        dmYenidenKur = anaSayfa && acikDm.canSend !== (anaGorunum.thread.canSend !== false)
        anaGorunum = { tur: 'dm', thread: acikDm }
      }
    }
    if (ark.status === 'fulfilled') { arkadasVerisi = ark.value; arkadasHatasi = false } else if (!arkadasVerisi) arkadasHatasi = true
    basligiGuncelle()
    if (!ilkCizimYapildi) return
    cizSerit()
    if (anaSayfa) {
      cizKanalPaneli()
      arkadasSayfasiniGuncelle()
      if (dmYenidenKur) { acikSohbetId = null; cizAnaSayfaMain() }
      aramaArayuzunuCiz() // kutu açıldı/kapandı: 📞 düğmesi de değişir
      if (anaGorunum.tur === 'dm') cizUyeler() // profil kartındaki arkadaşlık düğmesi değişmiş olabilir
    }
  }

  function cizKanalPaneli() {
    ilkCizimYapildi = true
    const sunucu = anaSayfa ? null : servers.find((s) => s.id === sunucuId)
    renderChannelList(panel, {
      server: sunucu,
      home: anaSayfa ? anaSayfaSolSutun() : null,
      channels: kanallar,
      profile,
      myStatus: benimDurumum(),
      myStatusText: varlikHaritasi.get(profile.id)?.statusText ?? '',
      selectedChannelId: kanalId,
      unread: okunmamis,
      // Çubuktaki Sustur/Sağırlaştır: aramadaysak aramanın durumu, değilsek kayıtlı tercih
      // (sesli kanaldaysak çubuk zaten voice.state'i gösterir)
      audio: arama ? arama.oturum.getState() : getSettings(),
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
      // DM aramasındaysak "Aramada · Ad" satırı: tıklayınca o DM, Kapat aramayı bitirir
      call: arama
        ? {
            peerName: arama.thread.other?.username ?? '',
            handlers: {
              onOpen: () => openDmView(arama.thread),
              onHangup: () => { aramadanCik('hangup') },
            },
          }
        : null,
      handlers: {
        onSelectChannel: kanalSec,
        onAddChannel: kanalEkle,
        onServerMenu: sunucuMenusu,
        onChannelMenu: kanalMenusu,
        onCopyInvite: () => davetKopyala(sunucu),
        onToggleMute: susturmayiDegistir,
        onToggleDeafen: sagirlastirmayiDegistir,
        onSettings: () => openSettings({
          ptt,
          onProfile: profilAc,
          onSignOut: cikisYap,
          account: { profile, email },
          notify: {
            mutedServers: () => servers.filter((s) => sessizSunucular.has(s.id)).map((s) => ({ id: s.id, name: s.name })),
            onUnmute: (id) => sessizeAl(id, false),
          },
        }),
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
    okunduIsaretle() // aynı kanala yeniden tıklandıysa sohbet yeniden kurulmaz: yine okundu say
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
    // Aramadaysak (ya da biri aranıyorsa) arama biter (onay sorulmaz), sonra kanala girilir.
    // Çalan gelen arama kartı da reddedilir (aynı anda tek ses).
    gelenArama.reddet()
    aramaAkisi.iptal()
    if (arama) aramadanCik('hangup', { ciz: false })
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

  // ---- Tek aktif ses: sesli kanal ya da DM araması ----
  // ses (kanal) ve arama aynı anda dolu olmaz: biri açılırken öteki kapanır (leave), mikrofon bir kez açılır.
  function aktifOturum() {
    return ses ?? arama?.oturum ?? null
  }
  function aktifSes() {
    if (ses) return { tur: 'kanal', oturum: ses, channelId: ses.channelId, serverId: sesSunucuId, channelName: sesKanalAdi }
    if (arama) return { tur: 'arama', oturum: arama.oturum, call: arama.call, thread: arama.thread }
    return null
  }

  // Aramanın sesine gir (arayan: arama başlarken; aranan: kabul edince). Arama arayüzü sonraki görevlerde.
  // Aramada voice_states'e yazılmaz (o tablo kanala bağlı); sinyal konusu dm-voice:<arama id>.
  function aramayaGir(call, thread) {
    if (durduruldu || !call?.id) return null
    if (arama?.call.id === call.id) return arama.oturum // zaten bu aramadayız
    katilmaNo++ // beklemedeki sesli kanal katılımı (başka pencere denetimi) artık katılmasın
    if (arama) aramadanCik('hangup', { ciz: false }) // başka bir arama açıksa biter
    if (ses) {
      sesliAyril(false)
      toast('Sesli kanaldan ayrıldın.')
    }
    // Çubukta seçilen Sustur/Sağırlaştır tercihiyle başla
    const tercih = getSettings()
    const oturum = createVoiceSession({
      channelId: call.id,
      topic: callTopic(call.id),
      userId: profile.id,
      muted: tercih.muted,
      deafened: tercih.deafened,
      shareState: true, // susturma/sağırlaştırma durumu sinyal konusundan karşıya gider
    })
    arama = { oturum, call, thread }
    guncellemeBandi?.refresh() // aramadayken güncelleme bandı gizlenir
    oturum.on('change', () => { if (arama?.oturum === oturum) cizKanalPaneli() }) // çubuktaki Sustur/Sağırlaştır
    oturum.on('notice', (metin) => { if (arama?.oturum === oturum) toast(metin) })
    // Kayıtlı ayarları oturuma uygula; kapı bas-konuşta kapalı başlar (tuşa basılana kadar)
    const s = getSettings()
    oturum.setBitrate(s.bitrateKbps)
    oturum.setUploadMbps(s.uploadMbps)
    oturum.setOutputDevice(s.outputDeviceId)
    oturum.setTransmitting(ptt.isOpen())
    askPttKeyIfNeeded(ptt) // tuş hiç seçilmediyse ilk katılışta sor
    // Katılma başarısızsa arama biter: karşı taraf boşuna beklemesin
    oturum.join().catch(() => {
      if (arama?.oturum !== oturum) return
      aramadanCik('lost')
      toast(ARAMA_METINLERI.baglantiKoptu, 'hata')
    })
    cizKanalPaneli()
    return oturum
  }

  // Aramadan çık: oturum kapanır (bye gider, dm-voice: kanalı bırakılır, mikrofon/izler/sayaçlar durur).
  // reason verilirse aramayı sunucuda da bitirir (endCall); karşı taraf zaten bitirdiyse null verilir.
  // Önce leave: bye, arama bitip konu kapanmadan gitsin.
  // Dönen Promise endCall bitince çözülür (hata yutulur; beklemek isteyen bekler).
  function aramadanCik(reason, { ciz = true } = {}) {
    if (!arama) return Promise.resolve()
    const { oturum, call } = arama
    arama = null
    oturum.leave()
    guncellemeBandi?.refresh()
    aramaAkisi.sesKapandi(call.id) // panel ve arama sayaçları (kopma, canlılık, süre) kapanır
    const is = reason
      ? endCall(call.id, reason).catch(() => { /* olmazsa sunucudaki bayatlık kuralı bitirir */ })
      : Promise.resolve()
    if (ciz && !durduruldu) cizKanalPaneli()
    aramaArayuzunuCiz()
    return is
  }

  // Sunucuyu seçer, kanallarını yükler; hatırlanan (yoksa ilk yazılı) kanalı açar.
  async function sunucuSec(id, tercihKanal) {
    anaSayfa = false
    yerYaz('sunucu')
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
    if (!anaSayfa) sohbet?.setMembers(uyeListesi) // @ önerisi ve @ad etiketleri
    cizUyeler()
  }

  // ---- Sunucu menüsü, ayrılma, silme, ad değiştirme; kanal menüsü ----
  // Veri işi başarısız olursa pencere açık kalır ve veritabanının Türkçe metni (yoksa genel metin) gösterilir.
  const ISLEM_BASARISIZ = 'İşlem yapılamadı. İnternetini kontrol edip tekrar dene.'
  const hataMetni = (e) => e?.message || ISLEM_BASARISIZ

  function sunucuMenusu(opener) {
    const sunucu = servers.find((s) => s.id === sunucuId)
    if (!sunucu) return
    openServerMenu({
      opener,
      sunucu,
      sahip: sunucu.owner_id === profile.id,
      sessiz: sessizSunucular.has(sunucu.id),
      tik: {
        onInvite: () => davetKopyala(sunucu),
        onToggleMute: () => { sessizeAl(sunucu.id, !sessizSunucular.has(sunucu.id)).catch(() => {}) },
        onSettings: () => sunucuAyarlari(sunucu),
        onAddChannel: () => kanalEkle('text'),
        onLeave: () => sunucudanAyril(sunucu),
        onDelete: () => sunucuyuSil(sunucu),
      },
    })
  }

  function kanalMenusu(kanal, opener) {
    openChannelMenu({
      opener,
      kanal,
      tik: { onRename: () => kanaliAdlandir(kanal), onDelete: () => kanaliSil(kanal) },
    })
  }

  // O sunucudaki sesli kanaldaysak önce oradan çıkarız (RPC'den ÖNCE: satırımız silinirken
  // yeniden yazılmasın). Var olan sesliAyril voice_states satırını da temizler.
  function sunucudaysaSestenCik(id) {
    if (ses && sesSunucuId === id) sesliAyril(false, { hemen: true })
  }

  function sunucudanAyril(sunucu) {
    leaveServerDialog(sunucu, async () => {
      try {
        sunucudaysaSestenCik(sunucu.id)
        await leaveServer(sunucu.id)
      } catch (e) { return hataMetni(e) }
      await listeleriTazele()
      return null
    })
  }

  function sunucuyuSil(sunucu) {
    deleteServerDialog(sunucu, async () => {
      try {
        sunucudaysaSestenCik(sunucu.id)
        await deleteServer(sunucu.id)
      } catch (e) { return hataMetni(e) }
      await listeleriTazele()
      return null
    })
  }

  function sunucuAyarlari(sunucu) {
    serverSettingsDialog(sunucu, {
      kopyala: () => davetKopyala(sunucu),
      kaydet: async (ad) => {
        try { await renameServer(sunucu.id, ad) } catch (e) { return hataMetni(e) }
        await listeleriTazele()
        return null
      },
    })
  }

  function kanaliAdlandir(kanal) {
    renameChannelDialog(kanal, async (ad) => {
      try { await renameChannel(kanal.id, ad) } catch (e) { return hataMetni(e) }
      await listeleriTazele()
      return null
    })
  }

  function kanaliSil(kanal) {
    deleteChannelDialog(kanal, async () => {
      try {
        if (ses?.channelId === kanal.id) sesliAyril(false, { hemen: true })
        await deleteChannel(kanal.id)
      } catch (e) { return hataMetni(e) }
      await listeleriTazele()
      return null
    })
  }

  // ---- Canlı güncelleme: sunucu olayı gelince ya da pencere odağa gelince listeler tazelenir ----
  // Aynı anda tek tazeleme çalışır; çalışırken gelen istekler tek bir ek tur olarak birleşir.
  let tazelemeIsi = null
  let tazelemeIstendi = false
  let sayilarIstendi = false // okunmamış sayıları da yeniden alınsın mı? (sunucu olayı: evet; yalnız pencere odağı: hayır)
  function listeleriTazele({ sayilar = true } = {}) {
    tazelemeIstendi = true
    if (sayilar) sayilarIstendi = true
    if (!tazelemeIsi) {
      tazelemeIsi = (async () => {
        try {
          while (tazelemeIstendi && !durduruldu) {
            tazelemeIstendi = false
            try { await tazeleTek() } catch { /* sessizce geç: sonraki olayda ya da odakta yeniden denenir */ }
          }
        } finally { tazelemeIsi = null }
      })()
    }
    return tazelemeIsi
  }

  async function tazeleTek() {
    const eskiListe = servers
    servers = await listMyServers()
    if (durduruldu) return
    sunucuDurumu = 'hazir'
    sunucuOlaylariniAyarla()
    okunmamis.prune(new Set(servers.map((s) => s.id))) // ayrıldığımız/silinen sunucuların sayısı toplamdan düşer
    // Yeni/silinen kanallar için sayılar yeniden alınır. Yalnız pencere odağıyla gelen tazelemede, sunucu
    // kümesi değişmediyse atlanır (alt-tab her seferinde sorgu atmasın).
    const kume = (l) => l.map((x) => x.id).sort().join()
    if (sayilarIstendi || kume(eskiListe) !== kume(servers)) {
      sayilarIstendi = false
      okunmamis.refresh()
    }
    const varMi = (id) => servers.some((s) => s.id === id)
    // Sesli kanalımızın sunucusu silindi (ya da başka pencereden ayrıldık): sesten çık, haber ver
    if (ses && !varMi(sesSunucuId)) {
      const gidenId = sesSunucuId
      sesliAyril(false, { hemen: true })
      // Başka pencereden biz ayrıldıysak "silindi" demeyiz
      toast(ayrildimIdleri.has(gidenId) ? 'Sunucudan ayrıldın.' : 'Bu sunucu silindi.')
    }
    // Bakılan sunucu artık yok: sıradakine (yoksa karşılama ekranına) geç
    if (sunucuId && !varMi(sunucuId)) {
      const sira = eskiListe.findIndex((s) => s.id === sunucuId)
      const hedef = servers[Math.min(Math.max(sira, 0), servers.length - 1)]
      if (hedef) await sunucuSec(hedef.id)
      else sunucuyuBosalt()
      return
    }
    if (sunucuId) {
      const id = sunucuId
      const liste = await listChannels(id)
      if (sunucuId !== id || durduruldu) return
      kanallariUygula(liste)
    }
    // Başka sunucuya bakarken sesli kanalımız silindiyse onu da yakala
    if (ses && sesSunucuId !== sunucuId) {
      try {
        const sesListe = await listChannels(sesSunucuId)
        if (ses && !sesListe.some((k) => k.id === ses.channelId)) sesliAyril(false, { hemen: true })
      } catch { /* sonraki olayda yeniden denenir; çizim yine de yapılır */ }
    }
    cizHepsi()
  }

  // Yeni kanal listesini uygular: açık kanal silindiyse ilk yazılıya geçilir
  function kanallariUygula(liste) {
    const eski = kanallar
    kanallar = liste
    if (ses && sesSunucuId === sunucuId) {
      const k = liste.find((x) => x.id === ses.channelId)
      if (!k) sesliAyril(false, { hemen: true }) // sesli kanalımız silindi
      else sesKanalAdi = k.name
    }
    const acik = liste.find((k) => k.id === yaziliId && k.kind === 'text')
    if (!acik) {
      yaziliId = liste.find((k) => k.kind === 'text')?.id ?? null
      if (yaziliId) sonuYaz(sunucuId, yaziliId)
    } else if (eski.find((k) => k.id === yaziliId)?.name !== acik.name) {
      sohbet?.renameChannel(acik.name) // yalnız adlar güncellenir; taslak ve düzenleme bozulmaz
    }
    if (!liste.some((k) => k.id === kanalId)) kanalId = yaziliId ?? liste[0]?.id ?? null
  }

  // Hiç sunucumuz kalmadı (ayrıldık ya da silindi): her şey boşalır, karşılama ekranı çıkar
  function sunucuyuBosalt() {
    sunucuId = null
    kanallar = []
    kanalId = null
    yaziliId = null
    uyeler = []
    uyeSunucusu = null
    sesAbonelikleriniAyarla()
    cizHepsi()
    cizUyeler()
  }

  // Veritabanından "degisti" olayı (ya da yeniden bağlanma) geldi
  const ayrildimIdleri = new Set() // başka pencerede kendimizin ayrıldığı sunucular (bildirim metni için)
  function sunucuOlayi(sid, payload) {
    if (durduruldu) return
    if (payload?.tablo === 'server_members' && payload?.islem === 'DELETE' && payload?.user_id === profile.id) ayrildimIdleri.add(sid)
    if (sid === sunucuId && (payload?.yeniden || payload?.tablo === 'server_members')) uyeleriYenile()
    listeleriTazele()
  }
  function uyeleriYenile() {
    const id = sunucuId
    if (!id) return
    listMembers(id)
      .then((liste) => {
        if (sunucuId !== id || durduruldu) return
        uyeler = liste
        uyeSunucusu = id
        if (ses && id === sesSunucuId) sesUyeleri = liste
        if (!anaSayfa) sohbet?.setMembers(liste) // @ önerisi ve @ad etiketleri
        cizUyeler()
        cizKanalPaneli()
        goruntu?.update()
      })
      .catch(() => { /* sonraki olayda yeniden denenir */ })
  }
  // Yedek: olay kaçmış olabilir; pencere odağa gelince listeler tazelenir
  const pencereOdaga = () => { listeleriTazele({ sayilar: false }); sosyalTazele(); sessizleriYukle(); okunduIsaretle() }
  window.addEventListener('focus', pencereOdaga)

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
  // Kişiye özel olaylar (arkadaşlık, yeni DM): gelince listeler yeniden alınır. Tek abonelik.
  // "arama" olayları da aynı konudan gelir (yeni abonelik yok)
  kullaniciOlaylari = subscribeUserEvents(profile.id, (p) => {
    if (durduruldu) return
    sosyalTazele()
    if (p?.yeniden) aramaAkisi.yenidenDenetle() // kopukken "arama" olayı kaçmış olabilir
  }, { onCall: aramaOlayi })
  // Bütün DM'lerin mesajları (okunmamış sayıları): tek abonelik; yeniden bağlanınca sayılar düzeltilir
  dmAboneligi = subscribeAllDmMessages({
    onInsert: dmMesajiGeldi,
    onUpdate: dmMesajiDegisti,
    onReconnect: () => { if (!durduruldu) sosyalTazele() },
  })
  sosyalTazele() // şeritteki DM rozeti ve profil kartı düğmeleri için (beklenmez)
  sessizleriYukle() // sessize alınan sunucular (şeritte soluk simge, bildirim kuralı; beklenmez)
  // Son seçilen yer Ana sayfaysa oradan açılır (davetle gelindiyse davetin sunucusu açılır)
  if (!kod && yerOku() === 'ana') anaSayfa = true
  try { await sunuculariYukle() } catch (e) { sunucuDurumu = 'hata'; toast(e.message, 'hata') }
  davetIsleniyor = !!kod
  cizHepsi()
  if (kod) {
    const katildi = await davetiIsle(kod)
    davetIsleniyor = false
    if (katildi) return
    cizMain() // davet geçersizdi: gerekirse karşılama kartı şimdi çıksın
  }
  if (anaSayfa) return
  await sonSunucuyuAc()
}
