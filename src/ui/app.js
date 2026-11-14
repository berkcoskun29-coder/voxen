// Giriş yapılmış kullanıcının ana ekranı: sunucu şeridi + kanal paneli + ana alan.
import { signOut } from '../auth/auth.js'
import { openProfileModal } from '../auth/profileModal.js'
import { createServer, inviteToCopy, joinByInvite, listMyServers, leaveServer, deleteServer, renameServer } from '../data/servers.js'
import { createChannel, listChannels, deleteChannel, renameChannel, getChannel } from '../data/channels.js'
import { subscribeServerEvents } from '../data/serverEvents.js'
import {
  openServerMenu, openChannelMenu, closeMenu, leaveServerDialog, deleteServerDialog, deleteChannelDialog,
  renameChannelDialog, serverSettingsDialog, kickMemberDialog,
} from './serverMenu.js'
import {
  loadServerRoles, createRole, updateRole, deleteRole, moveRole, setMemberRole, kickMember, regenerateInvite, moveChannel,
  hasPermission,
} from '../data/roles.js'
import { yetkiHesapla, kisiGorunumu, siraliRoller, ustSira, rolAtanabilir, cikarilabilir } from '../data/rolKurallari.js'
import { mountRolesPanel } from './roles.js'
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
import { fetchDmList, openDm, hideDm, canSendDm, dmSource, subscribeAllDmMessages, flushDmReads, resetDmReads } from '../data/dms.js'
import { subscribeUserEvents } from '../data/userEvents.js'
import { fetchMutedServers, muteServer, unmuteServer } from '../data/mutes.js'
import { fetchProfiles } from '../data/messages.js'
import { yetimleriTemizle } from '../data/attachments.js'
import { mentionsUser, mentionsEveryone } from '../mentions.js'
import { shouldNotify, shouldNotifyCall, createNotifier, getNotifySettings, requestNotifyPermission, bildirimBasligi, bildirimMetni } from '../notify.js'
import { renderHomeSidebar, createFriendsPage, sortDms, dmUnreadTotal, kisiDurumu } from './home.js'
import {
  fetchGroupList, createGroup, addGroupMember, removeGroupMember, leaveGroup, renameGroup, muteDm, unmuteDm,
  startGroupCall, joinGroupCall, leaveGroupCall, pingGroupCall, parseGroupCallEvent, grupAdi, grupAriyorMetni,
  fetchCallParticipants,
} from '../data/groups.js'
import { openCreateGroupDialog, openAddMemberDialog, openRenameGroupDialog, confirmLeaveGroup, renderGroupPanel } from './groupDm.js'
import { createGroupCallFlow, mountGroupCallPanel, grupAramaGorunumu, createGroupCallButton, GRUP_ARAMA_METINLERI } from './groupCall.js'
import { createMessageSearch } from './messageSearch.js'
import { searchMessages } from '../data/search.js'

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
// Açılıştan bu kadar sonra mesaja bağlı olmayan kendi eklerimiz depodan temizlenir (günde en çok bir kez;
// bkz. data/attachments.js yetimleriTemizle). Açılışı yavaşlatmasın diye beklenir.
const EK_TEMIZLIK_GECIKMESI_MS = 30000
// Çıkış'ta sesli durum silmesini en fazla bu kadar bekleriz (ağ yoksa çıkış takılmasın)
const CIKIS_BEKLEME_MS = 3000

// Üye listesini en sık bu aralıkla yeniden yükleriz (varlık her değiştiğinde sorgu atmamak için)
const UYE_YENILEME_MS = 2000
// Rol olayları (rolleri_sirala gibi tek işlemde birden çok satır) tek yüklemede birleşsin
const ROL_YUKLEME_GECIKMESI_MS = 150

export async function startApp(root, profile, { email = '' } = {}) {
  const { rail, channels: panel, main, members: uyePaneli } = mountLayout(root)
  // Ana alan: üstte kanal başlığı, altında DM arama paneli (o DM açıkken) ve görüntü bölmesi
  // (sesli kanaldayken), en altta sohbet
  const baslikAlani = document.createElement('div')
  baslikAlani.className = 'header-host'
  const aramaAlani = document.createElement('div')
  aramaAlani.className = 'call-host'
  // Grup araması paneli (011): ayrı kutu (bire bir panelle aynı kutuyu paylaşmasın)
  const grupAramaAlani = document.createElement('div')
  grupAramaAlani.className = 'call-host group-call-host'
  const goruntuAlani = document.createElement('div')
  goruntuAlani.className = 'video-host'
  const sohbetAlani = document.createElement('div')
  sohbetAlani.className = 'chat-host'
  main.append(baslikAlani, aramaAlani, grupAramaAlani, goruntuAlani, sohbetAlani)
  // Sohbet başlığının sağındaki "Üyeler" düğmesi: tek düğme, her kanal açılışında başlığa taşınır
  const uyeDugmesi = createMemberToggle(uyePaneli)
  // Mesaj arama (v0.10.0): başlıktaki 🔍 kutusu (tek öğe, görünüm değişince başlığa taşınır) ve sonuç paneli
  // (ana alanın sağında; açıkken CSS üye panelini gizler). Kapsam: sunucudayken o sunucu, Ana sayfada DM'ler.
  const mesajArama = createMessageSearch({
    ara: (cozum, { oncesi }) => searchMessages(anaSayfa || !sunucuId ? { tur: 'dm' } : { tur: 'sunucu', id: sunucuId }, cozum, { oncesi }),
    kapsam: () => (anaSayfa || !sunucuId ? 'dm' : 'sunucu'),
    bilgi: () => aramaOneriBilgisi(),
    onOpen: (sonuc) => { aramaSonucunuAc(sonuc).catch(() => { /* açılamadı: toast zaten gösterildi */ }) },
  })
  main.after(mesajArama.panel)
  let aramaKapsami = null // kutunun son kapsamı ('dm' ya da 's:<sunucu>'); değişince kutu boşalır
  let goruntu = null // açık görüntü bölmesi (sesli kanaldayken)
  let uyeler = []
  // v0.12 (inceleme Y2): üye listesi okumaları sırasız bitebilir. Her okuma artan bir numara alır; yalnız en son
  // uygulanandan daha yeni okumanın sonucu uygulanır (uyeler ve sesli kanalın izin listesi için ayrı ayrı). Eski bir
  // yanıt, bu arada çıkarılan kişiyi izin listesine geri ekleyemez.
  let uyeOkumaSayaci = 0
  let uyelerOkumaNo = 0 // uyeler dizisine en son uygulanan okuma
  let sesOkumaNo = 0 // sesli kanalın izin listesine en son uygulanan okuma (ya da çıkarma)
  const yeniUyeOkumasi = () => ++uyeOkumaSayaci
  // Okuma sonucu uyeler'e uygulanabilir mi (uygulanacaksa numara kaydedilir)
  function uyelerOkumasiGuncel(no) {
    if (no < uyelerOkumaNo) return false
    uyelerOkumaNo = no
    return true
  }
  // Okuma sonucu sesli kanalın izin listesine uygulanır (yalnız daha yeni okumaysa)
  function sesUyeleriniOkumadanAyarla(no, liste) {
    if (no < sesOkumaNo) return false
    sesOkumaNo = no
    sesUyeleriniAyarla(liste)
    return true
  }
  // Roller (v0.11.0): bakılan sunucunun rolleri ve atamaları. Sunucu değişince boşalır (bkz. rolVerisiniSifirla);
  // yüklenene kadar yetki eski kuralla hesaplanır (yalnız sahip yönetir).
  let rolVerisi = { serverId: null, roles: [], memberRoles: [] }
  let rolZamanlayici = null // rol olaylarını birleştiren gecikme
  let ayarlarRolPaneli = null // açık "Sunucu ayarları > Roller" paneli (canlı yenilensin)
  const cikarildimIdleri = new Set() // çıkarıldığım sunucular (bildirim metni için)
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
    onToggleCamera: () => arama?.oturum.toggleCamera(),
    onToggleScreen: () => arama?.oturum.toggleScreenShare(),
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
    const grupBilgi = grupAramaAkisi.bilgi()
    const dm = anaSayfa && anaGorunum.tur === 'dm' ? anaGorunum.thread : null
    // "Aramadasın" yalnız aramadaki kişinin DM'inde; başka DM'de "Zaten bir aramadasın."
    const kabul = gelenArama.kabulEdiliyor() // gelen arama kabul ediliyor (answerCall sürüyor)
    const aramaKonusu = bilgi?.thread?.id ?? grupBilgi?.thread?.id ?? arama?.thread?.id ?? kabul?.thread?.id ?? null
    const aramada = !!bilgi || !!grupBilgi || !!arama || !!kabul
    aramaDugmesi.update({
      canSend: dm?.canSend !== false,
      inCall: aramada,
      withPeer: !!dm && aramaKonusu === dm.id,
    })
    aramaPaneli.ciz(bilgi && dm && bilgi.thread?.id === dm.id ? aramaGorunumu(bilgi, profile) : null)
    // Grup: başlıktaki düğme (Grubu ara / Aramaya katıl (N) / Aramadasın) ve grubun üstündeki panel
    if (dm?.isGroup) {
      const buArama = aramaKonusu === dm.id
      grupAramaDugmesi.update({ call: buArama ? null : (dm.call ?? null), inThisCall: buArama, inOtherCall: aramada && !buArama })
    }
    const grupGorunum = grupBilgi && dm && grupBilgi.thread?.id === dm.id
      ? grupAramaGorunumu(grupBilgi, profile, guncelGrup(dm.id)?.members ?? dm.members ?? [])
      : null
    grupAramaPaneli.ciz(grupGorunum)
    // Aramanın görüntü bölmesi de yalnız aramanın DM'i açıkken görünür (arama ve görüntü arkada sürer).
    // Sesli kanalın bölmesi her zaman görünür (aynı anda ikisi olmaz: tek aktif ses).
    goruntuAlani.hidden = !!arama && !(dm && dm.id === arama.thread?.id)
  }
  // ---- Grup araması (groupCall.js, 011): başlıktaki düğme, grubun üstündeki panel ve akış ----
  const grupAramaDugmesi = createGroupCallButton({
    onStart: () => { if (anaSayfa && anaGorunum.tur === 'dm' && anaGorunum.thread.isGroup) grupAramaAkisi.baslat(anaGorunum.thread) },
    onJoin: (call) => { if (anaSayfa && anaGorunum.tur === 'dm' && anaGorunum.thread.isGroup) grupAramaAkisi.katil(anaGorunum.thread, call.id) },
  })
  const grupAramaPaneli = mountGroupCallPanel(grupAramaAlani, {
    onLeave: () => grupAramaAkisi.kapat(),
    onToggleMute: () => susturmayiDegistir(),
    onToggleDeafen: () => sagirlastirmayiDegistir(),
    onToggleCamera: () => arama?.oturum.toggleCamera(),
    onToggleScreen: () => arama?.oturum.toggleScreenShare(),
  })
  const grupAramaAkisi = createGroupCallFlow({
    selfId: profile.id,
    startGroupCall,
    joinGroupCall,
    leaveGroupCall,
    pingGroupCall,
    // Sunucu başka aramadaysak ALREADY_IN_CALL der: önce bire bir arama / gelen kart kapanır
    beforeJoin: async () => {
      const giden = aramaAkisi.bilgi()
      if (gelenArama.acik()) gelenArama.reddet()
      if (giden && giden.faz !== 'konusma') {
        aramaAkisi.iptal()
        if (giden.call?.id) await endCall(giden.call.id, 'cancel').catch(() => {})
      }
      if (arama) await aramadanCik('hangup', { ciz: false })
    },
    enter: (call, thread) => aramayaGir(call, thread),
    exit: (reason) => aramadanCik(reason),
    toast: (metin, tur) => toast(metin, tur),
    beep: (ad) => playBeep(ad),
    startTone: () => startLoop('bekleme'),
    onChange: () => aramaArayuzunuCiz(),
  })
  // Listede grubun en güncel satırı (üyeler/ad değişmiş olabilir)
  function guncelGrup(id) {
    return dmListesi.find((t) => t.id === id && t.isGroup) ?? null
  }
  const grupKartlari = new Set() // kartı bir kez gösterilen (ya da reddedilen) grup aramaları
  // Engellediğim kişi mi (arkadaş verisindeki engel listesi; grupta bildirim ve zil için)
  function engelledim(id) {
    return !!id && !!arkadasVerisi?.blocked?.some((k) => k.id === id)
  }
  // Grup aramasındaki bağlantıları sunucunun katılımcı listesine uydurur (011 düzeltme turu 1, I1):
  //  - Listede varsam: yalnız listedekilerle bağlı kalırım (gruptan çıkarılan/çıkmış sayılan eşin bağlantısı kapanır,
  //    sinyalleri yok sayılır).
  //  - Listede yoksam: sunucuya sorulur (sırası kaymış eski bir olay olabilir); ping false ise aramadan çıkılır.
  //    Gruptan çıkarıldıysam liste tazelenince sosyalTek "Gruptan çıkarıldın." der.
  function katilimcilariUzlastir(callId, ids) {
    if (durduruldu || !arama?.call?.isGroup || arama.call.id !== callId || !Array.isArray(ids)) return
    if (ids.includes(profile.id)) {
      arama.oturum.setAllowedPeers?.(ids.filter((id) => id !== profile.id))
      return
    }
    pingGroupCall(callId).then(async (surdu) => {
      if (surdu || durduruldu || arama?.call.id !== callId) return
      try { await sosyalTazele() } catch { /* liste alınamadı */ }
      if (durduruldu || arama?.call.id !== callId) return // sosyalTek çıkardı
      aramadanCik(null)
      toast(ARAMA_METINLERI.baglantiKoptu, 'hata')
    }).catch(() => { /* ağ hatası: canlılık kuralı bakar */ })
  }
  // Katılınca ve user: kanalı yeniden bağlanınca: katılımcılar veritabanından okunur
  function katilimcilariOku(callId) {
    fetchCallParticipants(callId).then((ids) => katilimcilariUzlastir(callId, ids)).catch(() => { /* bir sonraki olayda */ })
  }
  // "user:<uid>" konusundaki "grup_arama" olayları: listedeki "Aramaya katıl (N)", akış ve gelen kart
  function grupAramaOlayi(payload) {
    if (durduruldu) return
    const ev = parseGroupCallEvent(payload)
    if (!ev) return
    const bitti = ev.status === 'ended'
    const t = guncelGrup(ev.threadId)
    if (t) {
      const yeni = bitti || ev.count <= 0 ? null : { id: ev.callId, count: ev.count }
      dmListesi = dmListesi.map((x) => (x.id === t.id ? { ...x, call: yeni } : x))
      if (anaGorunum.tur === 'dm' && anaGorunum.thread.id === t.id) anaGorunum = { tur: 'dm', thread: guncelGrup(t.id) }
      if (ilkCizimYapildi && anaSayfa) cizKanalPaneli()
    } else if (!bitti) sosyalTazele() // grup listede yok (yeni eklendik): liste tazelenir
    grupAramaAkisi.olay(ev)
    if (!bitti && ev.participants) katilimcilariUzlastir(ev.callId, ev.participants)
    if (bitti) {
      gelenArama.kapat(ev.callId)
      grupKartlari.delete(ev.callId)
      if (arama?.call.id === ev.callId) aramadanCik(null)
    } else if (ev.status === 'ringing' && ev.caller !== profile.id) grupAramasiGeldi(ev)
    aramaArayuzunuCiz()
  }
  // Başkasının başlattığı grup araması: kart "Grup adı · berk arıyor". Meşgulsek ya da kart bir kez
  // gösterildiyse çıkmaz (liste/başlıktaki "Aramaya katıl" yine görünür). Sessizdeki grupta zil çalmaz.
  async function grupAramasiGeldi(ev) {
    if (grupKartlari.has(ev.callId)) return
    if (aramadaMesgul(ev) || grupAramaAkisi.bilgi()) return
    grupKartlari.add(ev.callId)
    // Engellediğim kişinin başlattığı grup araması kart ve zil çıkarmaz ("Aramaya katıl" listede kalır)
    if (engelledim(ev.caller)) return
    let t = guncelGrup(ev.threadId)
    if (!t) {
      try { await sosyalTazele() } catch { /* liste alınamadı */ }
      t = guncelGrup(ev.threadId)
    }
    if (!t || durduruldu || aramadaMesgul(ev) || grupAramaAkisi.bilgi()) return
    const arayan = t.members.find((u) => u.id === ev.caller) ?? { id: ev.caller, username: GELEN_ARAMA_METINLERI.bilinmeyen }
    const durum = bildirimDurumu()
    const ayarlar = getNotifySettings()
    const gosterildi = gelenArama.goster({
      callId: ev.callId,
      thread: t,
      zil: !t.muted && zilCalsinMi({ durum, ayarlar }),
      group: {
        title: grupAriyorMetni(grupAdi(t, profile.id), arayan.username),
        person: arayan,
        answer: (id) => joinGroupCall(id),
        leave: (id, neden) => leaveGroupCall(id, neden),
        onAccept: (call, thread) => {
          if (durduruldu) { leaveGroupCall(call.id, 'hangup').catch(() => {}); return }
          grupAramaAkisi.baglan({ ...call, caller: ev.caller }, guncelGrup(thread.id) ?? thread)
          openDmView(guncelGrup(thread.id) ?? thread)
        },
      },
    })
    if (gosterildi && !t.muted && shouldNotifyCall({ odakta: pencereOdakta(), durum, ayarlar })) {
      // Bildirim metni kartla aynı: "Grup adı · berk arıyor"
      const kapat = bildirimci.bildirArama({ id: ev.callId, ad: grupAdi(t, profile.id), metin: grupAriyorMetni(grupAdi(t, profile.id), arayan.username) })
      gelenArama.bildirimEkle(ev.callId, kapat)
    }
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
    return !!arama || !!aramaAkisi.bilgi() || !!grupAramaAkisi.bilgi() || !!gelenArama.kabulEdiliyor() ||
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
    const grupAcik = dmAcik && !!anaGorunum.thread.isGroup
    const dmKisi = grupAcik ? null : (dmKaynak?.other ?? (dmAcik ? anaGorunum.thread.other : null))
    const iz = grupAcik ? grupIziHesapla(anaGorunum.thread) : dmKisi ? dmKisiIziHesapla(dmKisi) : null
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
  let ekTemizligi = null // yetim ek temizliği zamanlayıcısı
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
    grupAramaPaneli.ciz(null)
    grupKartlari.clear()
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
    clearTimeout(ekTemizligi)
    guncellemeBandi?.dispose()
    masaustuBirak.forEach((f) => f())
    masaustuBirak = []
    varlik.stop()
    clearTimeout(uyeZamanlayici)
    clearTimeout(sesYabanciZamanlayici)
    uyeDugmesi.dispose()
    document.removeEventListener('keydown', aramaKisayolu)
    mesajArama.destroy()
    if (aktifDurdur === varligiDurdur) aktifDurdur = null
    if (aktifUygulama === buUygulama) aktifUygulama = null
  }
  aktifDurdur = varligiDurdur
  // Gönderilmeyen ya da mesajı silinen kendi eklerimiz (yetimler) depodan silinir (hata yutulur)
  ekTemizligi = setTimeout(() => { if (!durduruldu) yetimleriTemizle().catch(() => {}) }, EK_TEMIZLIK_GECIKMESI_MS)
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
    if (anaSayfa && anaGorunum.tur === 'dm' && anaGorunum.thread.isGroup) { cizGrupPaneli(); return }
    if (anaSayfa && anaGorunum.tur === 'dm') { cizDmProfili(); return }
    const r = rolVerisiBuSunucu()
    renderMemberList(uyePaneli, { members: uyeler, presence: varlikHaritasi, roles: r.roles, memberRoles: r.memberRoles })
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

  // Grup açıkken sağ panel: üyeler (kurucuya "Çıkar") ve grup işleri (groupDm.js)
  function cizGrupPaneli() {
    const thread = anaGorunum.thread
    dmKisiIzi = grupIziHesapla(thread)
    renderGroupPanel(uyePaneli, {
      thread,
      selfId: profile.id,
      presence: varlikHaritasi,
      handlers: {
        onAdd: () => uyeEkle(thread),
        onRemove: (kisi) => uyeCikar(thread, kisi),
        onRename: () => grubuAdlandir(thread),
        onToggleMute: () => grupSessiz(thread),
        onLeave: () => gruptanAyril(thread),
      },
    })
  }
  // Grup panelinin durum izi: üyelerin durumları değişince yeniden çizilir
  function grupIziHesapla(thread) {
    return JSON.stringify((thread.members ?? []).map((u) => [u.id, kisiDurumu(varlikHaritasi, u.id)]))
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
    const rolBilgisi = rolKartBilgisi(kisi)
    if (rolBilgisi) bilgi.sunucu = rolBilgisi
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
    const no = yeniUyeOkumasi()
    listMembers(id)
      .then((liste) => {
        if (sunucuId !== id || durduruldu) return // beklerken sunucu değişti ya da uygulama kapandı
        if (!uyelerOkumasiGuncel(no)) return // daha yeni bir okuma zaten uygulandı
        uyeler = liste
        if (ses && id === sesSunucuId) sesUyeleriniOkumadanAyarla(no, liste)
        if (!anaSayfa) sohbet?.setMembers(liste) // @ önerisi ve @ad etiketleri
        cizUyeler()
        cizKanalPaneli() // sesli kanaldaki kişiler de üye listesinden gelir
        goruntu?.update()
      })
      .catch(() => { /* sessizce geç: bir sonraki varlık değişiminde tekrar denenir */ })
      .finally(() => { uyeYukleniyor = false })
  }
  // ---- Roller ve izinler (v0.11.0) ----
  // Asıl koruma veritabanında (has_permission); burada yalnız hangi düğmenin görüneceği hesaplanır.
  // Üye listesi için (sunucuId'ye bakmaz: cizUyeler sunucuId tanımlanmadan önce de çağrılır; veri sunucu
  // değişince sıfırlandığı için hep bakılan sunucunundur)
  function rolVerisiBuSunucu() { return rolVerisi }
  function rolVerisiniSifirla(id = null) {
    rolVerisi = { serverId: id, roles: [], memberRoles: [] }
  }
  // Bir kişinin bir sunucudaki yetkisi (roller o sunucunun değilse yalnız sahiplik sayılır)
  function yetkiSunucuda(sid, userId = profile.id) {
    const server = servers.find((s) => s.id === sid) ?? null
    const r = rolVerisi.serverId === sid ? rolVerisi : { roles: [], memberRoles: [] }
    return yetkiHesapla({ server, roles: r.roles, memberRoles: r.memberRoles, userId })
  }
  // Bakılan sunucudaki yetkim
  function yetkim() {
    return anaSayfa || !sunucuId ? yetkiHesapla() : yetkiSunucuda(sunucuId)
  }
  // Rolleri yükler; bakılan sunucu hâlâ o ise uygular ve rolle ilgili her yeri yeniden çizer
  async function rolleriYukle(id) {
    let veri
    try { veri = await loadServerRoles(id) } catch { return } // sonraki olayda/seçimde yeniden denenir
    if (durduruldu || sunucuId !== id || anaSayfa) return
    rolVerisi = { serverId: id, roles: veri.roles, memberRoles: veri.memberRoles }
    rolleriCiz()
  }
  function rolleriGecikmeliYukle() {
    if (rolZamanlayici) return
    rolZamanlayici = setTimeout(() => {
      rolZamanlayici = null
      if (!durduruldu && sunucuId && !anaSayfa) rolleriYukle(sunucuId)
    }, ROL_YUKLEME_GECIKMESI_MS)
  }
  // Rol değişince: kanal paneli (+ kanal, ⚙), üye listesi (gruplar, renkler), sohbet (yazar rengi, @herkes,
  // 🗑️/📌) ve açık Roller paneli
  function rolleriCiz() {
    if (!ilkCizimYapildi || durduruldu) return
    cizKanalPaneli()
    if (!anaSayfa) cizUyeler()
    sohbet?.rollerDegisti?.()
    ayarlarRolPaneli?.yenile()
  }
  // "roller" olayı (server: konusu): bakılan sunucunun rolleri yeniden yüklenir.
  // { tablo: 'kick', user_id: ben }: çıkarıldım (üyelik silinince "degisti" de gelir, listeler tazelenir).
  function rolOlayi(sid, p) {
    if (durduruldu) return
    if (p?.tablo === 'kick') {
      if (p.user_id === profile.id && !cikarildimIdleri.has(sid)) {
        cikarildimIdleri.add(sid)
        const ad = servers.find((s) => s.id === sid)?.name
        toast(ad ? `${ad} sunucusundan çıkarıldın.` : 'Bir sunucudan çıkarıldın.')
      }
      return
    }
    if (sid === sunucuId && !anaSayfa) rolleriGecikmeliYukle()
  }
  // Profil kartının "Roller" bölümü ve "Sunucudan çıkar" (bakılan sunucunun üyesiyse)
  function rolKartBilgisi(kisi) {
    if (anaSayfa || !sunucuId || rolVerisi.serverId !== sunucuId) return null
    if (!uyeler.some((u) => u.id === kisi.id)) return null
    const sid = sunucuId
    const sunucu = servers.find((s) => s.id === sid)
    if (!sunucu) return null
    const y = yetkim()
    const { roles, memberRoles } = rolVerisi
    const hedefUstSira = ustSira(sunucu, roles, memberRoles, kisi.id)
    const benMi = kisi.id === profile.id
    const atanmis = new Set(memberRoles.filter((m) => m.user_id === kisi.id).map((m) => m.role_id))
    const roller = siraliRoller(roles).filter((r) => !r.is_default).map((rol) => ({
      rol,
      atanmis: atanmis.has(rol.id),
      degistirilebilir: rolAtanabilir(y, rol, { hedefUstSira, benMi, ver: !atanmis.has(rol.id) }),
    }))
    return {
      roller,
      onToggle: async (rol, ver) => {
        await setMemberRole(sid, kisi.id, rol.id, ver)
        await rolleriYukle(sid)
      },
      onKick: cikarilabilir(y, { hedefUstSira, benMi }) ? () => uyeyiCikar(sunucu, kisi) : undefined,
    }
  }
  function uyeyiCikar(sunucu, kisi) {
    kickMemberDialog(kisi, sunucu, async () => {
      try { await kickMember(sunucu.id, kisi.id) } catch (e) { return hataMetni(e) }
      uyeleriYenile()
      return null
    })
  }
  // Mesaj yazarının adı: en yüksek renkli rolün rengi (bakılan sunucuda)
  function rolRengi(userId) {
    return rolVerisi.serverId === sunucuId ? kisiGorunumu(rolVerisi.roles, rolVerisi.memberRoles, userId).renk : null
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
    // Grup sistem satırı (ekleme, ayrılma, çıkarma, ad): üyeler ya da ad değişti, liste yeniden alınır
    if (m.kind === 'system') sosyalTazele()
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

  // ---- Mesaj arama: Ctrl+F (⌘F) kutuya odaklar ----
  // Kutu görünürken (sunucu ya da Ana sayfa) ve açık bir pencere yokken; yoksa tarayıcının bul penceresi çalışır.
  function aramaKisayolu(e) {
    if (durduruldu || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 'f') return
    if (!mesajArama.kutu.isConnected || document.querySelector('.modal-back')) return
    e.preventDefault()
    mesajArama.odakla()
  }
  document.addEventListener('keydown', aramaKisayolu)
  // Kapsam değişince (başka sunucu, Sunucu <-> Ana sayfa) kutu boşalır, panel kapanır
  function aramaKapsaminiDenetle() {
    const k = anaSayfa || !sunucuId ? 'dm' : `s:${sunucuId}`
    if (k === aramaKapsami) return
    aramaKapsami = k
    mesajArama.sifirla()
  }
  // Öneri listesi için adlar: sunucuda üyeler ve metin kanalları; Ana sayfada DM kişileri ve grup üyeleri
  function aramaOneriBilgisi() {
    if (!anaSayfa && sunucuId) {
      return {
        kisiler: uyeler.map((u) => u.username).filter(Boolean),
        kanallar: kanallar.filter((k) => k.kind === 'text').map((k) => k.name),
      }
    }
    const adlar = new Set([profile.username])
    for (const t of dmListesi) {
      if (t.isGroup) for (const u of t.members ?? []) { if (u?.username) adlar.add(u.username) }
      else if (t.other?.username) adlar.add(t.other.username)
    }
    return { kisiler: [...adlar], kanallar: [] }
  }
  // Sonuca tıklandı: konuşmayı aç (gerekirse sunucuya geç), sonra mesaja git (chatView goToMessage)
  async function aramaSonucunuAc(s) {
    if (durduruldu || !s) return
    if (s.tur === 'channel') {
      if (!servers.some((v) => v.id === s.server_id)) return
      if (anaSayfa || sunucuId !== s.server_id || !kanallar.some((k) => k.id === s.channel_id)) await sunucuSec(s.server_id, s.channel_id)
      else if (yaziliId !== s.channel_id) kanalSec(s.channel_id)
      if (durduruldu || anaSayfa || sunucuId !== s.server_id || acikSohbetId !== s.channel_id) return
    } else {
      // Listede yoksa (gizlenmiş bire bir konuşma) sonucun bilgisiyle açılır; liste tazelenince güncellenir.
      // v0.12 (v10 K1): gizlenmiş bire bir konuşmada karşı taraf engelli olabilir (dm_list onu getirmez):
      // yazma kutusu açılmadan önce sunucuya sorulur (can_send_dm), sahte "yazılabilir" açılmaz.
      let thread = dmListesi.find((t) => t.id === s.thread_id)
      if (!thread && s.is_group) thread = { id: s.thread_id, isGroup: true, name: s.yer_adi ?? null, members: [], unread: 0, canSend: true }
      if (!thread) {
        const yazabilir = await canSendDm(s.thread_id).catch(() => false)
        if (durduruldu) return
        thread = dmListesi.find((t) => t.id === s.thread_id)
          ?? { id: s.thread_id, other: { id: s.other_id, username: s.yer_adi ?? '', color: null, avatar_url: null }, createdAt: null, lastMessageAt: null, unread: 0, canSend: yazabilir }
      }
      if (!(anaSayfa && anaGorunum.tur === 'dm' && anaGorunum.thread.id === thread.id)) openDmView(thread)
      if (!dmListesi.some((t) => t.id === s.thread_id)) sosyalTazele()
      if (durduruldu || acikSohbetId !== `dm:${s.thread_id}`) return
    }
    await sohbet?.goToMessage?.(s.id)
  }

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
  // DM: başlık karşı tarafın adı (grupta grubun adı). Sessizdeki grupta yalnız seni anan mesaj bildirim
  // verir; grup sistem satırları ve engellediğim kişinin grup mesajları (anma dahil) bildirim vermez.
  function dmBildirimi(m, thread) {
    if (durduruldu || !bildirimGelsinMi(m, 'dm')) return
    if (thread.isGroup && (m.kind === 'system' || engelledim(m.author_id) || (thread.muted && !mentionsUser(m.content, profile.username)))) return
    const ad = thread.isGroup ? grupAdi(thread, profile.id) : (thread.other?.username ?? '')
    bildirimci.bildir({
      hedef: { type: 'dm', id: thread.id },
      ad,
      baslik: bildirimBasligi({ tur: 'dm', ad }),
      metin: bildirimMetni(m.content),
    })
  }
  // Sunucu mesajı beni anıyorsa: başlık "Ad (#kanal, Sunucu)". Kanal ve yazar elimizde yoksa (başka
  // sunucu) veritabanından alınır; yalnız beni anan mesajlarda (seyrek) sorgu atılır.
  // @herkes/@everyone (v0.11.0): yalnız yazarın o sunucuda MENTION_EVERYONE izni varsa bildirim verir
  // (bakılan sunucuda yerel rollerden, başka sunucuda veritabanına sorulur; yalnız @herkes içeren seyrek mesajlarda).
  async function kanalMesajiGeldi(m, serverId) {
    const anar = mentionsUser(m.content, profile.username)
    if (durduruldu || (!anar && !mentionsEveryone(m.content))) return
    let kanal = kanallar.find((k) => k.id === m.channel_id) ?? null
    if (kanal) serverId = sunucuId
    // Ucuz ön denetim (sunucu biliniyorsa sessiz kuralı dahil); sorgudan sonra yeniden bakılır
    if (!bildirimGelsinMi({ ...m, server_id: serverId }, 'mention')) return
    try {
      if (!kanal) kanal = await getChannel(m.channel_id)
      if (!kanal) return
      serverId = kanal.server_id ?? serverId
      if (!anar) {
        const izinli = rolVerisi.serverId === serverId && sunucuId === serverId
          ? yetkiSunucuda(serverId, m.author_id).has('MENTION_EVERYONE')
          : await hasPermission(serverId, m.author_id, 'MENTION_EVERYONE')
        if (!izinli || durduruldu) return
      }
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
    // Aynı konudan tepki ve sabit olayları (009): açık sohbete iletilir, yeni abonelik yok
    else olaylar = subscribeServerEvents(idler, sunucuOlayi, { onReaction: (_sid, p) => tepkiOlayi(p), onPin: (_sid, p) => sabitOlayi(p), onRoles: (sid, p) => rolOlayi(sid, p) })
  }

  // Ana alan: sohbet her zaman SON SEÇİLEN YAZILI kanalı gösterir (sesli kanala tıklamak onu değiştirmez).
  // Aynı kanal zaten açıksa yeniden kurmayız; değişince eski sohbetin aboneliği kapatılır.
  // Hiç sunucu yoksa sohbet yerine karşılama kartı çizilir (acikSohbetId = 'karsilama');
  // sunucular yüklenemediyse hata kutusu ve "Yeniden dene" (acikSohbetId = 'hata'); yazılı kanal yoksa 'bos'.
  function cizMain() {
    aramaKapsaminiDenetle()
    if (anaSayfa) { cizAnaSayfaMain(); return }
    const kanal = kanallar.find((k) => k.id === yaziliId && k.kind === 'text')
    let anahtar = kanal?.id ?? 'bos' // 'bos': yazılı kanal yok (yükleniyor ya da yalnız sesli kanallar)
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
      yalinBaslik()
    } else if (anahtar === 'hata') {
      sohbetAlani.appendChild(renderLoadError('Sunucular yüklenemedi. Bağlantını kontrol edip yeniden dene.', yenidenDene))
      yalinBaslik()
    } else if (!kanal) {
      yalinBaslik() // yazılı kanalı olmayan sunucu (yalnız sesli kanallar): 🔍 kutusu yine başlıkta
    } else {
      sohbet = mountChat(sohbetAlani, {
        channel: kanal, profile, isOwner: servers.find((s) => s.id === sunucuId)?.owner_id === profile.id,
        headerActions: [mesajArama.kutu, uyeDugmesi.button], headerHost: baslikAlani, onBottom: () => okunduIsaretle(),
        members: uyeSunucusu === sunucuId ? uyeler : [],
        // Roller (v0.11.0): her çizimde yeniden sorulur
        getYetki: () => yetkim(),
        getRolRengi: (id) => rolRengi(id),
        herkesAnabilir: (id) => !!sunucuId && yetkiSunucuda(sunucuId, id).has('MENTION_EVERYONE'),
      })
    }
  }

  // v0.12 (v10 K2): sohbet yokken (karşılama, hata kartı, yazılı kanalı olmayan sunucu) başlıkta yalnız 🔍 kutusu
  // durur; Ctrl+F de ona odaklanır. Sunucu yokken kutu DM'lerde arar (bkz. aramaSunucusu).
  function yalinBaslik() {
    const baslik = document.createElement('div')
    baslik.className = 'main-header'
    const sag = document.createElement('div')
    sag.className = 'header-actions'
    sag.append(mesajArama.kutu)
    baslik.appendChild(sag)
    baslikAlani.appendChild(baslik)
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
      rolVerisiniSifirla()
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
    sonGruplar = sonGruplar.filter((t) => t.id !== thread.id)
    if (anaGorunum.tur === 'dm' && anaGorunum.thread.id === thread.id) anaGorunum = { tur: 'arkadaslar' }
    if (anaSayfa) cizHepsi()
    else cizSerit()
    sosyalTazele()
  }

  // ---- Grup işleri (groupDm.js pencereleri; hatalar pencerede yazar) ----
  const arkadaslarim = () => arkadasVerisi?.friends ?? []
  // "+" Grup oluştur: kurulunca grup açılır
  function grupOlustur() {
    openCreateGroupDialog({
      friends: arkadaslarim(),
      onCreate: async (ids, ad) => {
        const id = await createGroup(ids, ad)
        await sosyalTazele()
        if (durduruldu) return
        const t = guncelGrup(id)
        if (t) openDmView(t)
      },
    })
  }
  function uyeEkle(thread) {
    const uyeIdleri = new Set((thread.members ?? []).map((u) => u.id))
    openAddMemberDialog({
      candidates: arkadaslarim().filter((k) => !uyeIdleri.has(k.id)),
      onAdd: async (id) => { await addGroupMember(thread.id, id); sosyalTazele() },
    })
  }
  async function uyeCikar(thread, kisi) {
    try { await removeGroupMember(thread.id, kisi.id) } catch (e) { toast(e?.message || ISLEM_BASARISIZ, 'hata'); return }
    sosyalTazele()
  }
  function grubuAdlandir(thread) {
    openRenameGroupDialog({
      current: thread.name ?? '',
      onRename: async (ad) => { await renameGroup(thread.id, ad); await sosyalTazele() },
    })
  }
  async function grupSessiz(thread) {
    try {
      if (thread.muted) await unmuteDm(thread.id)
      else await muteDm(thread.id)
    } catch (e) { toast(hataMetni(e), 'hata'); return }
    await sosyalTazele()
    if (!durduruldu && anaSayfa && anaGorunum.tur === 'dm' && anaGorunum.thread.id === thread.id) cizUyeler()
  }
  function gruptanAyril(thread) {
    confirmLeaveGroup({
      ad: grupAdi(thread, profile.id),
      onLeave: async () => {
        // Bu grubun aramasındaysak önce oradan çıkılır (sunucu da çıkarır; ses hemen kapansın)
        if (arama?.thread?.id === thread.id) await aramadanCik(null)
        await leaveGroup(thread.id)
        if (durduruldu) return
        dmListesi = dmListesi.filter((t) => t.id !== thread.id)
        sonGruplar = sonGruplar.filter((t) => t.id !== thread.id)
        if (anaGorunum.tur === 'dm' && anaGorunum.thread.id === thread.id) anaGorunum = { tur: 'arkadaslar' }
        if (anaSayfa) cizHepsi()
        else cizSerit()
        sosyalTazele()
      },
    })
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
        peerStatus: thread.isGroup ? 'offline' : kisiDurumu(varlikHaritasi, thread.other?.id),
        onBottom: () => okunduIsaretle(),
        // 📞 Sesli arama başlat (grupta: Grubu ara / Aramaya katıl (N))
        headerActions: [mesajArama.kutu, thread.isGroup ? grupAramaDugmesi.button : aramaDugmesi.button],
      })
    } else {
      const sayfa = arkadasSayfasiniAl()
      arkadasSayfasiniGuncelle() // Ana sayfa dışındayken güncellenmedi: son veriyle çiz
      baslikAlani.appendChild(sayfa.header)
      sayfa.header.appendChild(mesajArama.kutu) // Arkadaşlar sayfasında da DM'lerde arama
      sohbetAlani.appendChild(sayfa.body)
    }
  }

  // Ana sayfanın sol sütunu (kanal panelinin içinde, kullanıcı çubuğunun üstünde)
  function anaSayfaSolSutun() {
    // İçinde olduğumuz grup aramasının satırında "Aramaya katıl" çıkmaz
    const icindeki = arama?.call?.isGroup ? arama.thread?.id : null
    return renderHomeSidebar({
      dms: icindeki ? dmListesi.map((t) => (t.id === icindeki ? { ...t, call: null } : t)) : dmListesi,
      presence: varlikHaritasi,
      view: anaGorunum,
      pending: arkadasVerisi?.incoming?.length ?? 0,
      selfId: profile.id,
      handlers: {
        onFriends: () => anaSayfayaGec({ tur: 'arkadaslar' }),
        onOpenDm: (thread) => openDmView(thread),
        onHideDm: (thread) => dmGizle(thread),
        onCreateGroup: () => grupOlustur(),
        onJoinCall: (thread) => {
          if (!thread.call) return
          openDmView(thread)
          grupAramaAkisi.katil(thread, thread.call.id)
        },
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
  let sonGruplar = [] // grup listesi alınamazsa eskisi kalır (bire bir liste yine güncellenir)
  async function sosyalTek() {
    const [dm, ark, gr] = await Promise.allSettled([fetchDmList(), fetchFriends(profile.id), fetchGroupList()])
    if (durduruldu) return
    let dmYenidenKur = false
    if (gr.status === 'fulfilled') sonGruplar = gr.value
    if (dm.status === 'fulfilled') {
      dmListesi = sortDms([...dm.value, ...sonGruplar])
      // Açık ve okunan DM'in işareti henüz yazılmamış olabilir: sunucudaki eski sayıyı gösterme
      if (dmKaynak && dmOkunuyor(dmKaynak.id)) dmListesi = dmListesi.map((t) => (t.id === dmKaynak.id ? { ...t, unread: 0 } : t))
      // Açık DM'de engel durumu değiştiyse (engellendi / kaldırıldı) sohbet yeni duruma göre yeniden kurulur
      const acikDm = anaGorunum.tur === 'dm' ? dmListesi.find((t) => t.id === anaGorunum.thread.id) : null
      if (acikDm) {
        dmYenidenKur = anaSayfa && acikDm.canSend !== (anaGorunum.thread.canSend !== false)
        // Grup: adı değiştiyse başlık yeniden kurulur; üyeler değiştiyse @ önerisi güncellenir
        if (acikDm.isGroup) {
          if (grupAdi(acikDm, profile.id) !== grupAdi(anaGorunum.thread, profile.id)) dmYenidenKur = anaSayfa
          else sohbet?.setMembers?.(acikDm.members)
        }
        anaGorunum = { tur: 'dm', thread: acikDm }
      } else if (anaGorunum.tur === 'dm' && anaGorunum.thread.isGroup && gr.status === 'fulfilled') {
        // Gruptan ayrıldık ya da çıkarıldık: Arkadaşlar sayfasına dönülür
        anaGorunum = { tur: 'arkadaslar' }
        dmYenidenKur = anaSayfa
        if (anaSayfa) sagPaneliAyarla()
      }
    }
    if (ark.status === 'fulfilled') { arkadasVerisi = ark.value; arkadasHatasi = false } else if (!arkadasVerisi) arkadasHatasi = true
    // Grup aramasındayım ama grup listemde yok: çıkarıldım ya da ayrıldım (gizlenen grup da listede olmaz:
    // sunucuya sorulur). Ping false ise aramadan hemen çıkılır.
    if (gr.status === 'fulfilled' && arama?.call?.isGroup && !sonGruplar.some((t) => t.id === arama.thread?.id)) {
      const callId = arama.call.id
      pingGroupCall(callId).then((surdu) => {
        if (surdu || durduruldu || arama?.call.id !== callId) return
        aramadanCik(null)
        toast(GRUP_ARAMA_METINLERI.cikarildin)
      }).catch(() => { /* ağ hatası: canlılık kuralı bakar */ })
    }
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
      // + kanal ve ⚙: MANAGE_CHANNELS (v0.11.0; roller yüklenene kadar yalnız sahip)
      canManageChannels: sunucu ? yetkim().has('MANAGE_CHANNELS') : false,
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
            peerName: arama.thread.isGroup ? grupAdi(guncelGrup(arama.thread.id) ?? arama.thread, profile.id) : (arama.thread.other?.username ?? ''),
            video: { camera: !!arama.oturum.getState().camera, screen: !!arama.oturum.getState().screen },
            handlers: {
              onToggleCamera: () => arama?.oturum.toggleCamera(),
              onToggleScreen: () => arama?.oturum.toggleScreenShare(),
              onOpen: () => openDmView(guncelGrup(arama.thread.id) ?? arama.thread),
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
    sesUyeleriniAyarla(uyeSunucusu === sunucuId ? uyeler : []) // üyeler henüz yüklenmediyse yüklenince gelir
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
    oturum.on('not-allowed', (id) => { if (ses === oturum) sesYabanciGeldi(id) }) // yeni katılan üye olabilir
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
    oturum.on('change', () => {
      if (arama?.oturum !== oturum) return
      cizKanalPaneli() // çubuktaki Sustur/Sağırlaştır
      aramaArayuzunuCiz() // paneldeki Kamera/Ekran düğmeleri ve hata satırı
      goruntu?.update() // kendi kamera/ekran önizlememiz
    })
    oturum.on('speaking', () => { if (arama?.oturum === oturum) goruntu?.update() }) // kutucuklardaki yeşil çerçeve
    oturum.on('tracks', () => { if (arama?.oturum === oturum) goruntu?.update() })
    // Görüntü bölmesi: kişiler biz ve karşı taraf; kim kamera/ekran açtı karşının gönderdiği durumdan
    // (aramada voice_states yok), izler oturumdan
    goruntu?.dispose()
    goruntu = mountVideoPane(goruntuAlani, {
      getPeers: () => {
        // Grup araması: bağlı olduğumuz bütün üyeler (çok kişi; videoPane zaten destekliyor)
        const kisiler = thread?.isGroup
          ? (guncelGrup(thread.id)?.members ?? thread.members ?? [])
              .filter((u) => u.id !== profile.id && (oturum.connectedPeers?.() ?? []).includes(u.id))
          : (thread?.other ? [thread.other] : [])
        const durumlar = new Map()
        for (const k of kisiler) durumlar.set(k.id, oturum.getPeerState(k.id) ?? {})
        return buildVideoPeers({ self: profile, members: kisiler, voiceStates: durumlar, session: oturum })
      },
      onHide: (id, gizli) => { oturum.setScreenHidden(id, gizli); goruntu?.update() },
      onVolume: (id, v) => oturum.setScreenVolume(id, v),
    })
    goruntu.update()
    if (call.isGroup) katilimcilariOku(call.id) // grup: yalnız aramadakilerle bağlan
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
    goruntu?.dispose() // aramanın görüntü bölmesi kapanır (videolar boşalır)
    goruntu = null
    goruntuAlani.hidden = false
    guncellemeBandi?.refresh()
    aramaAkisi.sesKapandi(call.id) // panel ve arama sayaçları (kopma, canlılık, süre) kapanır
    grupAramaAkisi.sesKapandi(call.id)
    // Grup aramasında yalnız biz ayrılırız (leaveGroupCall); 'decline' grupta yok, 'hangup' sayılır
    const is = !reason
      ? Promise.resolve()
      : call.isGroup
        ? leaveGroupCall(call.id, ['hangup', 'cancel', 'timeout', 'lost'].includes(reason) ? reason : 'hangup').catch(() => { /* bayatlık kuralı çıkarır */ })
        : endCall(call.id, reason).catch(() => { /* olmazsa sunucudaki bayatlık kuralı bitirir */ })
    if (ciz && !durduruldu) cizKanalPaneli()
    aramaArayuzunuCiz()
    return is
  }

  // Sunucuyu seçer, kanallarını yükler; hatırlanan (yoksa ilk yazılı) kanalı açar.
  async function sunucuSec(id, tercihKanal) {
    anaSayfa = false
    yerYaz('sunucu')
    if (rolVerisi.serverId !== id) rolVerisiniSifirla(id) // başka sunucunun rolleri bu sunucuda sayılmasın
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
    rolleriYukle(id) // roller üyelerle aynı anda (gelince ilgili yerler yeniden çizilir)
    // Üye listesi (çevrimiçi/çevrimdışı gruplu)
    let uyeListesi = []
    const no = yeniUyeOkumasi()
    try { uyeListesi = await listMembers(id) } catch (e) { toast(e.message, 'hata') }
    if (sunucuId !== id) return
    if (!uyelerOkumasiGuncel(no)) return // daha yeni bir okuma (olaydan) zaten uygulandı
    uyeler = uyeListesi
    uyeSunucusu = id
    if (ses && id === sesSunucuId) { sesUyeleriniOkumadanAyarla(no, uyeListesi); goruntu?.update() }
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
      izinler: yetkim(),
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
    // Aynı türdeki komşu varsa taşıma öğeleri (kanallar position sırasıyla gelir)
    const ayniTur = kanallar.filter((k) => k.kind === kanal.kind)
    const sira = ayniTur.findIndex((k) => k.id === kanal.id)
    openChannelMenu({
      opener,
      kanal,
      tik: {
        onRename: () => kanaliAdlandir(kanal),
        onDelete: () => kanaliSil(kanal),
        onMoveUp: sira > 0 ? () => kanaliTasi(kanal, -1) : undefined,
        onMoveDown: sira >= 0 && sira < ayniTur.length - 1 ? () => kanaliTasi(kanal, 1) : undefined,
      },
    })
  }

  async function kanaliTasi(kanal, yon) {
    try { await moveChannel(kanal.id, yon) } catch (e) { toast(hataMetni(e), 'hata'); return }
    await listeleriTazele()
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

  // Sunucu ayarları: Genel (MANAGE_SERVER: ad, davet kodu) ve Roller (MANAGE_ROLES) sekmeleri
  function sunucuAyarlari(sunucu) {
    const y = yetkim()
    const genel = y.has('MANAGE_SERVER')
    const sid = sunucu.id
    // Rol işlemleri: RPC, sonra roller yeniden yüklenir (panel güncel listeyi görsün); hata panele düşer
    const rolIsi = async (is) => {
      const sonuc = await is()
      await rolleriYukle(sid)
      return sonuc
    }
    serverSettingsDialog(sunucu, {
      genel,
      kopyala: () => davetKopyala(servers.find((s) => s.id === sid) ?? sunucu),
      kaydet: async (ad) => {
        try { await renameServer(sid, ad) } catch (e) { return hataMetni(e) }
        await listeleriTazele()
        return null
      },
      yenile: genel
        ? async () => {
            let kod
            try { kod = await regenerateInvite(sid) } catch (e) { return hataMetni(e) }
            await listeleriTazele()
            return { kod }
          }
        : null,
      roller: y.has('MANAGE_ROLES')
        ? () => {
            const panel = mountRolesPanel({
              getDurum: () => ({ roles: rolVerisi.serverId === sid ? rolVerisi.roles : [], yetki: yetkiSunucuda(sid) }),
              islemler: {
                olustur: () => rolIsi(() => createRole(sid, { name: 'yeni rol' })),
                kaydet: (rol, d) => rolIsi(() => updateRole(rol.id, d)),
                sil: (rol) => rolIsi(() => deleteRole(rol.id)),
                tasi: (rol, hedef) => rolIsi(() => moveRole(rol.id, hedef)),
              },
            })
            ayarlarRolPaneli = panel
            return {
              el: panel.el,
              kapat: () => { panel.kapat(); if (ayarlarRolPaneli === panel) ayarlarRolPaneli = null },
            }
          }
        : null,
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
      // Başka pencereden biz ayrıldıysak "silindi" demeyiz; çıkarıldıysak bildirim zaten gösterildi
      if (!cikarildimIdleri.has(gidenId)) toast(ayrildimIdleri.has(gidenId) ? 'Sunucudan ayrıldın.' : 'Bu sunucu silindi.')
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
    rolVerisiniSifirla()
    sesAbonelikleriniAyarla()
    cizHepsi()
    cizUyeler()
  }

  // Veritabanından "degisti" olayı (ya da yeniden bağlanma) geldi
  const ayrildimIdleri = new Set() // başka pencerede kendimizin ayrıldığı sunucular (bildirim metni için)
  // Tepki/sabit olayı (server: ya da user: konusu): açık sohbet kendi konuşmasınınkini işler, gerisini yok sayar
  function tepkiOlayi(p) { if (!durduruldu) sohbet?.applyReaction?.(p) }
  function sabitOlayi(p) { if (!durduruldu) sohbet?.applyPin?.(p) }
  function sunucuOlayi(sid, payload) {
    if (durduruldu) return
    if (payload?.tablo === 'server_members' && payload?.islem === 'DELETE' && payload?.user_id === profile.id) ayrildimIdleri.add(sid)
    if (ses && sid === sesSunucuId && (payload?.yeniden || payload?.tablo === 'server_members')) sesUyeOlayi(sid, payload)
    if (sid === sunucuId && (payload?.yeniden || payload?.tablo === 'server_members')) uyeleriYenile()
    if (sid === sunucuId && payload?.yeniden && !anaSayfa) rolleriGecikmeliYukle() // kaçan "roller" olayı olabilir
    listeleriTazele()
  }
  // v0.12 (v11 K1): sunucu sesli kanalında yalnız sunucu üyeleriyle bağlantı kurulur. Sunucudan çıkarılan biri
  // değiştirilmiş bir istemciyle sinyal kanalında kalsa bile dürüst eşler onun teklifine cevap vermez, var olan
  // bağlantısı da kapanır. Liste henüz yüklenmediyse (boş) herkes serbest kalır; yüklenince süzgeç başlar.
  const SES_YABANCI_ARALIK_MS = 5000
  function sesUyeleriniAyarla(liste) {
    sesUyeleri = liste
    if (!ses) return
    ses.setAllowedPeers?.(liste.length ? liste.map((u) => u.id).filter((id) => id !== profile.id) : null)
  }
  // Sesli kanalımızın sunucusunda üyelik değişti (katılma, çıkma, çıkarılma) ya da bağlantı yeniden kuruldu (kaçan
  // olay olabilir): çıkan/çıkarılan kişinin eşi hemen kapanır, liste yeniden okunur (başka sunucuya bakarken de; o
  // sunucuya bakıyorsak uyeleriYenile zaten okuyor). Yeni katılan liste gelince izinli olur; setAllowedPeers ona
  // özel hello gönderir.
  function sesUyeOlayi(sid, payload) {
    if (payload.islem === 'DELETE' && payload.user_id && payload.user_id !== profile.id && sesUyeleri.length) {
      // Çıkarma da bir "okuma" sayılır: ondan önce başlamış okumaların (eski) sonucu artık uygulanmaz
      sesUyeleriniOkumadanAyarla(yeniUyeOkumasi(), sesUyeleri.filter((u) => u.id !== payload.user_id))
      goruntu?.update()
    }
    if (sid === sunucuId) return
    sesUyeleriniOku(sid)
  }
  // İzin listesinde olmayan birinden hello/teklif geldi: olay kaçmış ya da gecikmiş olabilir (yeni katılan üye).
  // Liste yeniden okunur. Sınırlar (çıkarılmış ya da sahte "from" gönderen biri sorgu yağmuru açamasın):
  //  - aynı kişi için en çok 5 sn'de bir (harita 100 kişiyi geçince boşaltılır);
  //  - inceleme Y3: bütün kişiler için toplam en çok 5 sn'de bir okuma. Pencere içinde gelen istek atılmaz,
  //    pencere bitince TEK bir okuma yapılır (yeni üyenin hello'su kaybolmasın).
  // Üyeyse setAllowedPeers ona özel hello gönderir, bağlantı kurulur; değilse yok sayılmaya devam eder.
  const sesYabanciZamani = new Map() // userId -> son istek zamanı
  let sesYabanciSonOkuma = -Infinity // son (yabancı kaynaklı) okumanın zamanı
  let sesYabanciZamanlayici = null // pencere sonunda yapılacak tek okuma
  function sesYabanciGeldi(id) {
    if (!id || !ses || !sesSunucuId || durduruldu) return
    const simdi = Date.now()
    if (simdi - (sesYabanciZamani.get(id) ?? -Infinity) < SES_YABANCI_ARALIK_MS) return
    if (sesYabanciZamani.size >= 100) sesYabanciZamani.clear()
    sesYabanciZamani.set(id, simdi)
    if (sesYabanciZamanlayici) return // pencere sonundaki okuma zaten bekliyor
    const bekle = sesYabanciSonOkuma + SES_YABANCI_ARALIK_MS - simdi
    if (bekle <= 0) { sesYabanciOku(); return }
    sesYabanciZamanlayici = setTimeout(() => { sesYabanciZamanlayici = null; sesYabanciOku() }, bekle)
  }
  function sesYabanciOku() {
    if (!ses || !sesSunucuId || durduruldu) return
    sesYabanciSonOkuma = Date.now()
    sesUyeleriniOku(sesSunucuId)
  }
  function sesUyeleriniOku(sid) {
    const no = yeniUyeOkumasi()
    listMembers(sid)
      .then((liste) => {
        if (durduruldu || !ses || sesSunucuId !== sid) return
        if (sesUyeleriniOkumadanAyarla(no, liste)) goruntu?.update()
      })
      .catch(() => { /* sonraki olayda yeniden denenir */ })
  }
  function uyeleriYenile() {
    const id = sunucuId
    if (!id) return
    const no = yeniUyeOkumasi()
    listMembers(id)
      .then((liste) => {
        if (sunucuId !== id || durduruldu) return
        if (!uyelerOkumasiGuncel(no)) return // daha yeni bir okuma zaten uygulandı
        uyeler = liste
        uyeSunucusu = id
        if (ses && id === sesSunucuId) sesUyeleriniOkumadanAyarla(no, liste)
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
    if (p?.yeniden && arama?.call?.isGroup) katilimcilariOku(arama.call.id) // "grup_arama" da kaçmış olabilir
  }, { onCall: aramaOlayi, onGroupCall: grupAramaOlayi, onReaction: (p) => tepkiOlayi(p), onPin: (p) => sabitOlayi(p) })
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
