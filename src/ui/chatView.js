// Sohbet ekranı (yazılı kanal ya da özel mesaj): mesaj listesi, sonsuz kaydırma, yazı kutusu, anlık mesajlar.
// Mesajlar bir "kaynak" nesnesinden gelir (kanal: messages.js channelSource, DM: dms.js dmSource).
import { channelSource, fetchProfiles, MAX_UZUNLUK, SAYFA } from '../data/messages.js'
import { GONDEREMEZSIN } from '../data/dms.js'
import { toast } from './layout.js'
import { linkliMetin } from './links.js'
import { avatarTextColor } from './avatarColor.js'
import { avatarWithDot } from './memberList.js'
import { makeProfileOpener } from './profileOpener.js'
import { eylemCubugu, duzenlendiEtiketi, duzenlemeKutusu, silmeOnayi } from './messageActions.js'
import { bahsetmeliMetin, mountMentionSuggest } from './mentions.js'
import { mentionsUser } from '../mentions.js'
import { EMOJILER, gomuluTepkiler, gomuluSabit } from '../data/reactions.js'
import { tepkiRozetleri, tepkiSecici } from './reactions.js'
import { sabitListesiAc, kisalt } from './pins.js'

// Sistem satırı (DM): arama kaydı ('call') ya da "… bir mesajı sabitledi." ('pin'). Yalnız sunucu yazar.
const sistemMi = (m) => m?.kind === 'call' || m?.kind === 'pin'

// Yönelme eki (Türkçe ünlü uyumu): "berk'e", "ayla'ya", "can'a", "kerem'e".
// Brief'teki "**ad**'a yanıt veriyorsun" kalıbının doğru Türkçesi.
export function yonelmeEki(ad) {
  const harfler = Array.from(String(ad ?? '')).filter((c) => /\p{L}/u.test(c)).map((c) => c.toLocaleLowerCase('tr'))
  const unluler = 'aıoueiöü'
  const sonUnlu = harfler.slice().reverse().find((c) => unluler.includes(c))
  const kalin = !sonUnlu || 'aıou'.includes(sonUnlu)
  const unluyleBiter = unluler.includes(harfler.at(-1) ?? '')
  return (unluyleBiter ? 'y' : '') + (kalin ? 'a' : 'e')
}

// Yanıt alıntısı: yanıtlanan mesajın yazarı ve ilk 80 karakteri. Tıklayınca asıl mesaja gidilir.
// yanit: { durum: 'var'|'silindi'|'yukleniyor', ad, metin }. Silinmişse "Mesaj silindi" yazar, tıklanmaz.
function yanitAlintisi(yanit, onJump) {
  if (yanit.durum !== 'var') {
    const d = document.createElement('div')
    d.className = 'msg-reply msg-reply-gone'
    d.textContent = yanit.durum === 'silindi' ? 'Mesaj silindi' : '…'
    return d
  }
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'msg-reply'
  const isaret = document.createElement('span')
  isaret.className = 'msg-reply-icon'
  isaret.setAttribute('aria-hidden', 'true')
  isaret.textContent = '↩'
  const ad = document.createElement('strong')
  ad.className = 'msg-reply-author'
  ad.textContent = yanit.ad
  const metin = document.createElement('span')
  metin.className = 'msg-reply-text'
  metin.textContent = yanit.metin
  b.append(isaret, ad, metin)
  b.setAttribute('aria-label', `${yanit.ad} kişisinin mesajına yanıt: ${yanit.metin} — mesaja git`)
  b.onclick = () => onJump?.()
  return b
}

// Sabitli mesajın küçük 📌 işareti
function sabitIsareti() {
  const s = document.createElement('span')
  s.className = 'msg-pin'
  s.setAttribute('role', 'img')
  s.setAttribute('aria-label', 'Sabitlendi')
  s.dataset.tip = 'Sabitlendi'
  s.textContent = '📌'
  return s
}

const BES_DAKIKA = 5 * 60 * 1000

const saatBicimi = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' })
const tarihBicimi = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

// Bir mesajı çizer. Kullanıcı yazısı HER ZAMAN textContent ile basılır (güvenlik).
// grouped: true ise başlık (avatar/ad/saat) çizilmez; avatarın yerinde, üzerine gelince görünen küçük saat olur.
// Metindeki http/https adresleri tıklanır link olur (links.js; yine innerHTML yok).
// izin: { duzenle, sil } -> sağ üstteki simgeler; tik: { onEdit(), onDelete(shiftBasili) }.
// editor: verilirse mesaj metni yerine bu düzenleme kutusu (öğe) konur.
// uyeler: verilirse (kanalda sunucu üyeleri) metindeki @ad üye ise etiket olur (src/ui/mentions.js).
// anar: true ise mesaj seni anıyor: solda çizgi, hafif renkli zemin (.mentioned).
// tepkiler: [{ emoji, adlar, benim }] -> altta rozetler (tepkiAktif false ise pasif); tik.onToggleReaction(emoji, ekle).
// yanit: { durum, ad, metin } -> üstte alıntı; tik.onJump() asıl mesaja gider. sabitli: 📌 işareti.
// vurgulu: kısa süreli vurgu (alıntıdan/listeden gelindi).
export function renderMessage(msg, profile, { grouped = false, izin = null, tik = null, editor = null, uyeler = null, anar = false, tepkiler = null, tepkiAktif = true, yanit = null, sabitli = false, vurgulu = false } = {}) {
  // Sistem satırı (DM, kind 'call' arama kaydı / 'pin' sabitleme): ortalanmış soluk satır; avatar, ad başlığı
  // ve eylem simgeleri yok
  if (sistemMi(msg)) {
    const satir = document.createElement('div')
    satir.className = 'message call-log' + (msg.kind === 'pin' ? ' pin-log' : '')
    satir.dataset.id = String(msg.id)
    satir.textContent = msg.content
    return satir
  }
  const p = profile ?? { username: 'Bilinmeyen', color: '#8d93a1', avatar_url: null }
  const el = document.createElement('div')
  el.className = 'message' + (grouped ? ' grouped' : '') + (anar ? ' mentioned' : '') + (vurgulu ? ' flash' : '')
  el.dataset.id = String(msg.id)

  if (!grouped) {
    let av
    if (p.avatar_url) {
      av = document.createElement('img')
      av.src = p.avatar_url
      av.alt = ''
    } else {
      av = document.createElement('span')
      av.textContent = (Array.from(p.username)[0] ?? '?').toLocaleUpperCase('tr')
    }
    av.classList.add('msg-avatar')
    // Avatara ya da ada tıklayınca profil kartı açılır (dinleyici app.js'te)
    makeProfileOpener(av, profile, `profil-mesaj-${msg.id}`, { tabsiz: true })
    av.style.background = p.color
    av.style.color = avatarTextColor(p.color)
    el.appendChild(av)
  } else {
    // Gruplanmış satır: avatar boşluğunda küçük saat (CSS yalnız üzerine gelince gösterir)
    const kucukSaat = document.createElement('span')
    kucukSaat.className = 'msg-hover-time'
    kucukSaat.textContent = saatBicimi.format(new Date(msg.created_at))
    el.appendChild(kucukSaat)
  }

  const govde = document.createElement('div')
  govde.className = 'msg-body'
  if (yanit) {
    el.classList.add('has-reply')
    govde.appendChild(yanitAlintisi(yanit, () => tik?.onJump?.()))
  }
  if (!grouped) {
    const ust = document.createElement('div')
    ust.className = 'msg-head'
    const ad = document.createElement('span')
    ad.className = 'msg-author'
    ad.textContent = p.username
    ad.style.color = p.color
    makeProfileOpener(ad, profile, null, { yalnizFare: true }) // ad fareyle tıklanır; klavyede durak avatar
    const saat = document.createElement('span')
    saat.className = 'msg-time'
    saat.textContent = saatBicimi.format(new Date(msg.created_at))
    ust.append(ad, saat)
    // "(düzenlendi)" saatin yanında durur (spec §1); üzerine gelince düzenleme zamanı görünür
    if (msg.edited_at && !editor) ust.appendChild(duzenlendiEtiketi(msg.edited_at))
    if (sabitli) ust.appendChild(sabitIsareti())
    govde.appendChild(ust)
  }
  const metin = document.createElement('div')
  metin.className = 'msg-text'
  if (editor) {
    el.classList.add('editing')
    govde.appendChild(editor)
  } else {
    metin.appendChild(uyeler ? bahsetmeliMetin(msg.content, uyeler) : linkliMetin(msg.content))
    // Gruplanmış satırda görünür saat yok (yalnız hover'da); etiket bu durumda metnin sonunda kalır
    if (msg.edited_at && grouped) metin.appendChild(duzenlendiEtiketi(msg.edited_at))
    if (sabitli && grouped) metin.appendChild(sabitIsareti())
    govde.appendChild(metin)
  }
  const rozetler = tepkiRozetleri(tepkiler, { aktif: tepkiAktif, onToggle: (emoji, ekle) => tik?.onToggleReaction?.(emoji, ekle) })
  if (rozetler) govde.appendChild(rozetler)
  el.appendChild(govde)
  if (!editor && izin && tik) {
    const cubuk = eylemCubugu(izin, tik)
    if (cubuk) el.appendChild(cubuk)
  }
  return el
}

// Hiç sunucusu olmayan kullanıcıya ana alanın ortasında karşılama kartı.
// handlers: { onCreate() -> "Sunucu oluştur" penceresi, onJoin() -> "Sunucuya katıl" penceresi }
export function renderWelcome(profile, handlers) {
  const kutu = document.createElement('div')
  kutu.className = 'welcome'
  const kart = document.createElement('div')
  kart.className = 'welcome-card'
  const logo = document.createElement('img')
  logo.className = 'welcome-logo'
  logo.src = '/favicon.svg'
  logo.alt = ''
  const h = document.createElement('h2')
  h.textContent = `Voxen'e hoş geldin, ${profile.username}!` // textContent: kullanıcı adı HTML olarak çalışmaz
  const p = document.createElement('p')
  p.textContent = 'Arkadaşlarınla konuşmak için bir sunucu kur ya da sana gelen davet linkiyle birine katıl.'
  const dugmeler = document.createElement('div')
  dugmeler.className = 'welcome-buttons'
  const olustur = document.createElement('button')
  olustur.type = 'button'
  olustur.className = 'welcome-create'
  olustur.textContent = '+ Sunucu oluştur'
  olustur.onclick = () => handlers.onCreate?.()
  const katil = document.createElement('button')
  katil.type = 'button'
  katil.className = 'secondary welcome-join'
  katil.textContent = 'Davetle katıl'
  katil.onclick = () => handlers.onJoin?.()
  dugmeler.append(olustur, katil)
  kart.append(logo, h, p, dugmeler)
  kutu.appendChild(kart)
  return kutu
}

// Yükleme hatası kutusu: kısa açıklama + "Yeniden dene" düğmesi (ör. sunucu listesi gelmediyse)
export function renderLoadError(mesaj, onRetry) {
  const kutu = document.createElement('div')
  kutu.className = 'welcome load-error'
  kutu.setAttribute('role', 'alert')
  const kart = document.createElement('div')
  kart.className = 'load-error-card'
  const p = document.createElement('p')
  p.textContent = mesaj
  const dugme = document.createElement('button')
  dugme.type = 'button'
  dugme.textContent = 'Yeniden dene'
  dugme.onclick = () => onRetry?.()
  kart.append(p, dugme)
  kutu.appendChild(kart)
  return kutu
}

// Aynı günün anahtarı (gün değişimini bulmak için)
const gunAnahtari = (iso) => new Date(iso).toDateString()

// Sohbeti container içine kurar. Dönen destroy() abonelikleri kapatır.
// source: mesaj kaynağı (channelSource ya da dmSource). Verilmezse eski yol: channel: {id, name} ile
// kanal kaynağı burada kurulur. profile: giriş yapan kullanıcının profili.
// DM'de (source.kind 'dm') başlıkta karşı tarafın avatarı + durum noktası (peerStatus) ve adı çıkar;
// source.canSend false ise (engel) yazı kutusu yerine "Bu kişiye mesaj gönderemezsin." yazar.
// headerActions: başlığın sağına konacak düğmeler (ör. "Üyeler" düğmesi; app.js verir).
// headerHost verilirse başlık container'a değil ona konur (app.js: başlık görüntü bölmesinin üstünde durur).
// isOwner: giriş yapan kişi bu sunucunun sahibi mi (sahip başkasının mesajını da silebilir; app.js verir).
// onBottom(sonMesajId): kullanıcı en alta indi ya da en alttayken mesaj geldi (app.js okundu işaretler).
// members: kanalda sunucu üyeleri (@ önerisi ve @ad etiketleri; sonradan setMembers ile güncellenir). DM'de kullanılmaz.
export function mountChat(container, { source = null, channel = null, profile, isOwner = false, headerActions = [], headerHost = null, onBottom = null, peerStatus = 'offline', members = [] }) {
  const kaynak = source ?? channelSource(channel, { isOwner, selfId: profile.id })
  const dm = kaynak.kind === 'dm'
  const yazabilir = kaynak.canSend !== false
  let mesajlar = [] // eskiden yeniye
  const idler = new Set() // aynı mesaj iki kez eklenmesin
  const profiller = new Map([[profile.id, profile]])
  let kapandi = false
  let eskiVar = true // daha eski mesaj olabilir mi
  let yukleniyor = false
  // Açık düzenleme: { id, ed }. ed (düzenleme kutusu öğesi) liste yeniden çizilince AYNEN yeniden konur,
  // böylece yeni mesaj ya da canlı güncelleme gelse de yazılan kaybolmaz.
  let duzenle = null
  let uyeler = members // @bahsetme için sunucu üyeleri (yalnız kanalda)
  // --- Tepki, yanıt, sabit (009) ---
  // Kaynak bu işleri desteklemiyorsa (eski/sahte kaynak) özellikler kapalı kalır.
  const tepkiVar = typeof kaynak.react === 'function'
  const sabitVar = typeof kaynak.pin === 'function'
  const tepkiler = new Map() // mesaj id -> Map(emoji -> [user_id, ...]) (eklenme sırasıyla)
  const sabitler = new Set() // sabitli mesaj id'leri
  const yanitHedefleri = new Map() // listede olmayan yanıtlanan mesajlar: id -> { author_id, content, deleted_at }
  let yanit = null // yazı kutusundaki yanıt: { id, ad }
  let vurgulu = null // kısa süre vurgulanan mesaj id'si
  let vurguZamani = null

  container.innerHTML = ''
  if (headerHost) headerHost.innerHTML = ''
  const baslik = document.createElement('header')
  baslik.className = 'main-header'
  let adi = kaynak.title // kanal yeniden adlandırılınca güncellenir (bkz. renameChannel)
  // Kanalda # simgesi (süs: ekran okuyucudan gizli); DM'de karşı tarafın avatarı ve durum noktası
  let diyez
  if (dm) diyez = baslikAvatari(peerStatus)
  else {
    diyez = document.createElement('span')
    diyez.className = 'header-hash'
    diyez.setAttribute('aria-hidden', 'true')
    diyez.textContent = '#'
  }
  const kanalAdi = document.createElement('span')
  kanalAdi.className = 'header-name'
  kanalAdi.textContent = adi
  baslik.append(diyez, kanalAdi)
  // 📌 Sabitlenmiş mesajlar düğmesi (kaynak destekliyorsa), app.js'in düğmelerinden önce
  const sabitDugmesi = typeof kaynak.fetchPinned === 'function' ? document.createElement('button') : null
  if (sabitDugmesi) {
    sabitDugmesi.type = 'button'
    sabitDugmesi.className = 'icon-btn pins-toggle'
    sabitDugmesi.dataset.tip = 'Sabitlenmiş mesajlar'
    sabitDugmesi.dataset.tipSide = 'bottom'
    sabitDugmesi.setAttribute('aria-label', 'Sabitlenmiş mesajlar')
    sabitDugmesi.setAttribute('aria-haspopup', 'dialog')
    sabitDugmesi.textContent = '📌'
    sabitDugmesi.onclick = () => sabitListesiniAc()
  }
  const sagDugmeler = [...(sabitDugmesi ? [sabitDugmesi] : []), ...headerActions]
  if (sagDugmeler.length) {
    // Sağdaki düğmeler kutusu (CSS margin-left: auto ile sağa yaslar)
    const sag = document.createElement('div')
    sag.className = 'header-actions'
    sag.append(...sagDugmeler)
    baslik.appendChild(sag)
  }
  const liste = document.createElement('div')
  liste.className = 'message-list'
  const alt = document.createElement('div')
  alt.className = 'composer'
  const uyari = document.createElement('div')
  uyari.className = 'composer-warning'
  const kutu = document.createElement('textarea')
  kutu.rows = 1
  kutu.placeholder = kaynak.placeholder
  // "yazıyor…" satırı: yüksekliği sabit (boşken de yer tutar), aria-live YOK (sürekli konuşmasın)
  const yaziyor = document.createElement('div')
  yaziyor.className = 'typing-line'
  // @ önerisi yalnız sunucu kanalında (DM'de iki kişisiniz). Kutunun Enter dinleyicisinden ÖNCE bağlanır.
  const oneri = !dm && yazabilir ? mountMentionSuggest(kutu, { getMembers: () => uyeler, selfId: profile.id }) : null
  if (oneri) alt.appendChild(oneri.el)
  // Yanıt şeridi: "berk'e yanıt veriyorsun ✕" (yanıt yokken gizli). Ekran okuyucu değişimi duyar.
  const yanitSeridi = document.createElement('div')
  yanitSeridi.className = 'reply-bar'
  yanitSeridi.hidden = true
  yanitSeridi.setAttribute('aria-live', 'polite')
  if (yazabilir) alt.append(yanitSeridi, uyari, kutu, yaziyor)
  else {
    // Engel: kutu kapanır, yerine açıklama (eski mesajlar görünür kalır)
    const kapali = document.createElement('div')
    kapali.className = 'composer-blocked'
    kapali.textContent = GONDEREMEZSIN
    alt.appendChild(kapali)
  }
  if (headerHost) { headerHost.appendChild(baslik); container.append(liste, alt) }
  else container.append(baslik, liste, alt)

  const enAltta = () => liste.scrollHeight - liste.scrollTop - liste.clientHeight < 40

  // "Alta yapışık": kullanıcı en alttaysa liste boyu değişince de (ör. üstte görüntü bölmesi
  // açılıp kapanınca, pencere boyutlanınca) en altta kalsın. Kaydırınca güncellenir.
  let altaYapisik = true
  // Gözlemcinin en son gördüğü liste yüksekliği. Kaydırma olayı geldiğinde yükseklik bundan farklıysa
  // olay kullanıcıdan değil yerleşimden gelmiştir (ör. görüntü bölmesi açıldı, tarayıcı kaydırmayı
  // oynattı); o zaman "alta yapışık" bilgisini bozmayız, gözlemci birazdan doğru yere indirir.
  let olculenYukseklik = null
  const gozlemci = globalThis.ResizeObserver
    ? new ResizeObserver(() => {
        if (kapandi) return
        olculenYukseklik = liste.clientHeight
        if (altaYapisik) liste.scrollTop = liste.scrollHeight
      })
    : null // eski tarayıcı / test ortamı: yalnız mesaj gelince inilir

  // DM başlığındaki küçük avatar + durum noktası (durum değişince setPeerStatus yenisini koyar)
  function baslikAvatari(durum) {
    const av = avatarWithDot(kaynak.other ?? { username: kaynak.title, color: null }, durum, 'header-avatar')
    av.classList.add('header-dm-avatar')
    av.setAttribute('aria-hidden', 'true') // ad hemen yanında yazıyor
    return av
  }

  // Konuşmanın başlangıcı bloğu. Kanal: büyük #, "#kanal kanalına hoş geldin!" ve kısa yazı.
  // DM: büyük @, kişinin adı ve "@ad ile özel mesajlarının başlangıcı."
  // Yalnız en eski mesaj yüklendiyse (daha eskisi yoksa) listenin en tepesine konur.
  function baslangicBlogu() {
    const blok = document.createElement('div')
    blok.className = 'channel-start'
    const simge = document.createElement('div')
    simge.className = 'channel-start-icon'
    simge.setAttribute('aria-hidden', 'true')
    simge.textContent = dm ? '@' : '#'
    const h = document.createElement('h2')
    const p = document.createElement('p')
    if (dm) {
      h.textContent = adi // textContent: kişi adı HTML olarak çalışmaz
      p.textContent = `@${adi} ile özel mesajlarının başlangıcı.`
    } else {
      h.textContent = `#${adi} kanalına hoş geldin!` // textContent: kanal adı HTML olarak çalışmaz
      // Henüz mesaj yoksa ilk adımı söyle; mesaj varsa yalnız başlangıç olduğunu belirt
      p.textContent = mesajlar.length === 0 ? 'Bu kanalın başlangıcı. İlk mesajı sen yaz.' : 'Bu kanalın başlangıcı.'
    }
    blok.append(simge, h, p)
    return blok
  }

  // Listeyi baştan çizer (ardışık mesaj gruplaması ve gün çizgileri burada).
  function ciz() {
    // Yeniden çizim odağı sökmesin: düzenleme kutusunda ya da bir simgede odak varsa sonda geri veririz
    const odak = document.activeElement
    let geriOdak = null
    if (odak && liste.contains(odak)) {
      if (duzenle && odak === duzenle.ed.kutu) geriOdak = { kutu: true, bas: odak.selectionStart, son: odak.selectionEnd }
      else if (odak.dataset?.act) geriOdak = { id: odak.closest('.message')?.dataset.id, act: odak.dataset.act }
      else if (odak.classList?.contains('reaction')) geriOdak = { id: odak.closest('.message')?.dataset.id, emoji: odak.dataset.emoji }
    }
    liste.innerHTML = ''
    if (!eskiVar) liste.appendChild(baslangicBlogu()) // en eski mesaj yüklendi: blok en tepede
    let onceki = null
    for (const m of mesajlar) {
      if (!onceki || gunAnahtari(onceki.created_at) !== gunAnahtari(m.created_at)) {
        const ayrac = document.createElement('div')
        ayrac.className = 'day-separator'
        ayrac.textContent = tarihBicimi.format(new Date(m.created_at))
        liste.appendChild(ayrac)
        onceki = null // gün değişince başlık yeniden çizilsin
      }
      const gruplu =
        onceki !== null &&
        !sistemMi(onceki) && // sistem satırı kimseyle gruplanmaz; sonraki mesaj başlığını yeniden çizer
        !sistemMi(m) &&
        m.reply_to == null && // yanıt mesajı hep adıyla başlar (alıntının kime ait olduğu belli olsun)
        onceki.author_id === m.author_id &&
        new Date(m.created_at) - new Date(onceki.created_at) <= BES_DAKIKA
      liste.appendChild(renderMessage(m, profiller.get(m.author_id), {
        grouped: gruplu,
        // Yazılamayan (engelli) DM'de düzenleme, tepki, yanıt ve sabitleme yok; silme kalır
        izin: {
          tepki: tepkiVerilebilir(m),
          yanitla: yanitlanabilir(m),
          sabitle: sabitlenebilir(m),
          sabitli: sabitler.has(m.id),
          duzenle: duzenlenebilir(m),
          sil: !!kaynak.canDelete(m),
        },
        tik: {
          onReact: (dugme) => seciciAc(m.id, dugme),
          onReply: () => yanitBaslat(m.id),
          onPin: () => sabitDegistir(m.id, !sabitler.has(m.id)),
          onToggleReaction: (emoji, ekle) => tepkiDegistir(m.id, emoji, ekle),
          onJump: () => mesajaGit(m.reply_to),
          onEdit: () => duzenleBaslat(m.id),
          onDelete: (shift) => silIste(m.id, shift),
        },
        editor: duzenle?.id === m.id ? duzenle.ed.el : null,
        uyeler: dm ? null : uyeler,
        anar: !dm && m.author_id !== profile.id && mentionsUser(m.content, profile.username),
        tepkiler: tepkiOzeti(m.id),
        tepkiAktif: tepkiVerilebilir(m),
        yanit: m.reply_to != null ? yanitBilgisi(m.reply_to) : null,
        sabitli: sabitler.has(m.id),
        vurgulu: vurgulu === m.id,
      }))
      onceki = m
    }
    if (duzenle) duzenle.ed.boyutla()
    if (geriOdak?.kutu && duzenle) {
      duzenle.ed.kutu.focus({ preventScroll: true })
      try { duzenle.ed.kutu.setSelectionRange(geriOdak.bas, geriOdak.son) } catch { /* sorun değil */ }
    } else if (geriOdak?.act) {
      liste.querySelector(`.message[data-id="${geriOdak.id}"] [data-act="${geriOdak.act}"]`)?.focus({ preventScroll: true })
    } else if (geriOdak?.emoji) {
      const rozet = [...liste.querySelectorAll(`.message[data-id="${geriOdak.id}"] .reaction`)].find((b) => b.dataset.emoji === geriOdak.emoji)
      ;(rozet ?? liste.querySelector(`.message[data-id="${geriOdak.id}"] [data-act="tepki"]`))?.focus({ preventScroll: true })
    }
  }

  // Kaydırmayı koruyarak yeniden çizer (canlı güncelleme, düzenleme açılıp kapanması):
  // alttaysak altta, değilsek olduğumuz yerde kalırız.
  function yenidenCiz() {
    const altta = enAltta()
    const ust = liste.scrollTop
    ciz()
    liste.scrollTop = altta ? liste.scrollHeight : ust
  }

  // --- Düzenleme ve silme ---
  const bul = (id) => mesajlar.find((m) => m.id === id)
  // Kendi mesajı, yazılabilir konuşma ve kaynak izin veriyor (DM'de arama kaydı satırı düzenlenemez)
  function duzenlenebilir(m) {
    return m.author_id === profile.id && yazabilir && (kaynak.canEdit?.(m) ?? true)
  }

  // --- Tepkiler ---
  function tepkiVerilebilir(m) {
    return tepkiVar && yazabilir && !sistemMi(m) && !!kaynak.canReact?.(m)
  }
  function yanitlanabilir(m) {
    return yazabilir && !sistemMi(m) && !m.deleted_at
  }
  function sabitlenebilir(m) {
    return sabitVar && !sistemMi(m) && !!kaynak.canPin?.(m)
  }

  // Rozet özeti: EMOJILER sırasıyla [{ emoji, adlar, benim }] (adı bilinmeyen null: "N kişi daha"ya katılır)
  function tepkiOzeti(id) {
    const harita = tepkiler.get(id)
    if (!harita) return null
    const ozet = []
    for (const emoji of EMOJILER) {
      const kisiler = harita.get(emoji)
      if (!kisiler?.length) continue
      ozet.push({ emoji, adlar: kisiler.map((u) => profiller.get(u)?.username ?? null), benim: kisiler.includes(profile.id) })
    }
    return ozet.length ? ozet : null
  }

  // Tek tepki değişimini işler (kendi işlemimiz ya da canlı olay). Tekrar gelirse etkisizdir.
  // Dönüş: değişti mi.
  function tepkiIsle({ message_id: id, emoji, user_id: kim, islem }) {
    if (!bul(id) || !EMOJILER.includes(emoji) || !kim) return false
    const harita = tepkiler.get(id) ?? new Map()
    const kisiler = harita.get(emoji) ?? []
    const var_ = kisiler.includes(kim)
    if (islem === 'INSERT' && !var_) harita.set(emoji, [...kisiler, kim])
    else if (islem === 'DELETE' && var_) harita.set(emoji, kisiler.filter((u) => u !== kim))
    else return false
    tepkiler.set(id, harita)
    return true
  }

  // Sorgudan gelen satırların gömülü tepki/sabit bilgisini haritalara yazar (bilgi yoksa dokunmaz).
  function gomuluIsle(satirlar) {
    for (const m of satirlar) {
      const t = gomuluTepkiler(m)
      if (t) {
        const harita = new Map()
        for (const r of t) {
          const kisiler = harita.get(r.emoji) ?? []
          if (!kisiler.includes(r.user_id)) kisiler.push(r.user_id)
          harita.set(r.emoji, kisiler)
        }
        tepkiler.set(m.id, harita)
      }
      const s = gomuluSabit(m)
      if (s === null) sabitler.delete(m.id)
      else if (s !== undefined) sabitler.add(m.id)
    }
  }

  const tepkiSuruyor = new Set() // "id:emoji" (çift tık tek istek)
  async function tepkiDegistir(id, emoji, ekle) {
    const m = bul(id)
    if (!m || !tepkiVerilebilir(m)) return
    const anahtar = `${id}:${emoji}`
    if (tepkiSuruyor.has(anahtar)) return
    tepkiSuruyor.add(anahtar)
    try {
      await kaynak.react(id, emoji, ekle)
      if (kapandi) return
      if (tepkiIsle({ message_id: id, emoji, user_id: profile.id, islem: ekle ? 'INSERT' : 'DELETE' })) yenidenCiz()
    } catch (e) {
      if (!kapandi) toast(e?.message || 'Tepki verilemedi. Tekrar dene.', 'hata')
    } finally {
      tepkiSuruyor.delete(anahtar)
    }
  }

  function seciciAc(id, dugme) {
    if (kapandi || !dugme) return
    tepkiSecici(dugme, {
      // Seçicideki emojiye zaten tepki verdiysem kaldırılır (rozete tıklamakla aynı)
      onSec: (emoji) => tepkiDegistir(id, emoji, !(tepkiler.get(id)?.get(emoji) ?? []).includes(profile.id)),
      donusOdagi: () => liste.querySelector(`.message[data-id="${id}"] [data-act="tepki"]`) ?? kutu,
    })
  }

  // --- Sabitleme ---
  function sabitIsle(id, sabit) {
    if (sabit === sabitler.has(id)) return false
    if (sabit) sabitler.add(id)
    else sabitler.delete(id)
    return true
  }
  async function sabitDegistir(id, sabitle) {
    try {
      await kaynak.pin(id, sabitle)
      if (!kapandi && sabitIsle(id, sabitle) && bul(id)) yenidenCiz()
    } catch (e) {
      if (!kapandi) toast(e?.message || 'Sabitlenemedi. Tekrar dene.', 'hata')
    }
  }
  function sabitListesiniAc() {
    sabitListesiAc({
      yukle: () => kaynak.fetchPinned(),
      adBul: (uid) => profiller.get(uid)?.username ?? 'Bilinmeyen',
      yetkili: (m) => sabitVar && !!kaynak.canPin?.(m),
      kaldir: async (id) => {
        await kaynak.pin(id, false)
        if (!kapandi && sabitIsle(id, false) && bul(id)) yenidenCiz()
      },
      git: (id) => mesajaGit(id),
      profilleriYukle: (ms) => eksikProfilleriYukle(ms.map((m) => m.author_id)),
    })
  }

  // --- Yanıtlama ---
  // Yanıtlanan mesajın alıntı bilgisi: listede ya da önbellekte; yoksa "…" (getirilince yeniden çizilir)
  function yanitBilgisi(hedefId) {
    const h = bul(hedefId) ?? yanitHedefleri.get(hedefId)
    if (!h) return { durum: 'yukleniyor' }
    if (h.deleted_at) return { durum: 'silindi' }
    return { durum: 'var', ad: profiller.get(h.author_id)?.username ?? 'Bilinmeyen', metin: kisalt(h.content, 80) }
  }

  // Listede olmayan yanıt hedeflerini tek sorguda getirir (silinmişler de gelir). Gelmeyen: silinmiş sayılır.
  async function yanitHedefleriniYukle(satirlar) {
    if (typeof kaynak.fetchByIds !== 'function') return
    const eksik = [...new Set(satirlar.map((m) => m.reply_to).filter((r) => r != null))]
      .filter((r) => !bul(r) && !yanitHedefleri.has(r))
    if (eksik.length === 0) return
    try {
      const gelen = await kaynak.fetchByIds(eksik)
      for (const h of gelen) yanitHedefleri.set(h.id, h)
      for (const r of eksik) if (!yanitHedefleri.has(r)) yanitHedefleri.set(r, { id: r, deleted_at: 'yok' })
      await eksikProfilleriYukle(gelen.map((h) => h.author_id))
    } catch { /* alıntı "…" kalır; bir sonraki yüklemede yeniden denenir */ }
  }

  function yanitSeridiniCiz() {
    yanitSeridi.textContent = ''
    yanitSeridi.hidden = !yanit
    if (!yanit) return
    const yazi = document.createElement('span')
    yazi.className = 'reply-bar-text'
    const ad = document.createElement('strong')
    ad.textContent = yanit.ad
    yazi.append(ad, `'${yonelmeEki(yanit.ad)} yanıt veriyorsun`)
    const iptal = document.createElement('button')
    iptal.type = 'button'
    iptal.className = 'reply-bar-cancel'
    iptal.setAttribute('aria-label', 'Yanıtı iptal et')
    iptal.dataset.tip = 'Yanıtı iptal et (Esc)'
    iptal.textContent = '✕'
    iptal.onclick = () => yanitIptal(true)
    yanitSeridi.append(yazi, iptal)
  }
  function yanitBaslat(id) {
    const m = bul(id)
    if (!m || !yanitlanabilir(m) || kapandi) return
    yanit = { id, ad: profiller.get(m.author_id)?.username ?? 'Bilinmeyen' }
    yanitSeridiniCiz()
    kutu.focus()
  }
  function yanitIptal(odakVer = false) {
    if (!yanit) return
    yanit = null
    yanitSeridiniCiz()
    if (odakVer) kutu.focus()
  }

  // Asıl mesaja kaydırır ve 2 sn vurgular. Yüklü değilse eski mesajlar sayfa sayfa yüklenir (en çok 10 sayfa).
  async function mesajaGit(id) {
    if (id == null || kapandi) return
    for (let i = 0; i < 10 && !bul(id) && eskiVar && mesajlar.length && Number(id) < Number(mesajlar[0].id); i++) {
      const once = mesajlar.length
      await eskileriYukle()
      if (kapandi) return
      if (mesajlar.length === once && yukleniyor) await new Promise((r) => setTimeout(r, 50)) // başka yükleme sürüyor
    }
    if (kapandi) return
    if (!bul(id)) { toast('Mesaj bulunamadı'); return }
    vurgulu = id
    clearTimeout(vurguZamani)
    const el = liste.querySelector(`.message[data-id="${id}"]`)
    el?.classList.add('flash')
    const azalt = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    el?.scrollIntoView?.({ block: 'center', behavior: azalt ? 'auto' : 'smooth' })
    vurguZamani = setTimeout(() => {
      vurgulu = null
      liste.querySelector('.message.flash')?.classList.remove('flash')
    }, 2000)
  }

  function duzenleBaslat(id) {
    const m = bul(id)
    if (!m || !duzenlenebilir(m) || kapandi) return
    if (duzenle?.id === id) { duzenle.ed.kutu.focus(); return }
    const ed = duzenlemeKutusu(m.content, {
      kaydet: (metin) => duzenleKaydet(id, ed, metin),
      vazgec: () => duzenleKapat(true),
    })
    duzenle = { id, ed } // öncekinde yarım kalan varsa atılır (aynı anda tek kutu)
    yenidenCiz()
    ed.kutu.focus()
    ed.kutu.setSelectionRange(ed.kutu.value.length, ed.kutu.value.length)
    liste.querySelector('.editing')?.scrollIntoView?.({ block: 'nearest' })
  }

  function duzenleKapat(odakVer) {
    duzenle = null
    yenidenCiz()
    if (odakVer) kutu.focus()
  }

  async function duzenleKaydet(id, ed, metin) {
    const m = bul(id)
    if (!m || ed.kaydediyor) return
    if (metin.trim() === m.content) { duzenleKapat(true); return } // değişmedi: boşuna istek atma
    ed.kaydediyor = true
    try {
      const sonuc = await kaynak.edit(id, metin)
      if (kapandi) return
      if (!sonuc.ok) { ed.uyar(sonuc.warning || 'Mesaj boş olamaz. Silmek için 🗑️ simgesini kullan.'); return }
      if (duzenle?.ed === ed) duzenle = null // bu arada mesaj silindiyse kutu zaten kapanmıştır
      mesajGuncelle(sonuc.message)
      if (!duzenle) kutu.focus()
    } catch {
      if (!kapandi) toast('Mesaj düzenlenemedi. Tekrar dene.', 'hata')
    } finally {
      ed.kaydediyor = false
    }
  }

  // Gelen satırı (düzenleme sonucu ya da canlı UPDATE) listedeki mesaja işler. Açık düzenleme kutusuna dokunmaz.
  function mesajGuncelle(satir) {
    const i = mesajlar.findIndex((m) => m.id === satir.id)
    if (i < 0) return
    mesajlar[i] = { ...mesajlar[i], ...satir }
    yenidenCiz()
  }

  // Mesaj silindi: listeden kalkar. id bir daha eklenmesin diye idler'de kalır.
  function mesajKaldir(id, yenidenCizme = false) {
    idler.add(id)
    // Bu mesaja verilen yanıtların alıntısı "Mesaj silindi" desin; tepkisi ve sabiti gider
    const eski = bul(id) ?? yanitHedefleri.get(id)
    yanitHedefleri.set(id, { ...(eski ?? { id }), deleted_at: eski?.deleted_at || 'silindi' })
    tepkiler.delete(id)
    sabitler.delete(id)
    if (yanit?.id === id) { yanitIptal(); toast('Yanıtladığın mesaj silindi.') }
    const vardi = mesajlar.length
    mesajlar = mesajlar.filter((m) => m.id !== id)
    if (duzenle?.id === id) { duzenle = null; toast('Düzenlediğin mesaj silindi.') }
    if (!yenidenCizme && mesajlar.length !== vardi) yenidenCiz()
  }

  const siliniyor = new Set() // silme isteği süren mesaj id'leri (çift Shift+tık tek istek atsın)

  async function silYap(m) {
    if (siliniyor.has(m.id)) return null
    siliniyor.add(m.id)
    try { await kaynak.remove(m.id) } catch { return 'Mesaj silinemedi. Tekrar dene.' } finally { siliniyor.delete(m.id) }
    if (!kapandi) mesajKaldir(m.id)
    return null
  }

  function silIste(id, shift) {
    const m = bul(id)
    if (!m) return
    if (shift) { // Shift+tık: onaysız (Discord alışkanlığı)
      silYap(m).then((hata) => { if (hata && !kapandi) toast(hata, 'hata') })
      return
    }
    silmeOnayi(m, profiller.get(m.author_id)?.username ?? 'Bilinmeyen', () => silYap(m), () => {
      // Mesaj silindiyse 🗑️ düğmesi de gitti: odak kaybolmasın, yazı kutusuna dönsün
      if (!kapandi && !bul(id) && yazabilir) kutu.focus()
    })
  }

  // Yeniden bağlanınca: kopukken yapılan düzenleme/silmeleri yakala. Görünen en eski mesajdan
  // sonrasını sayfa sayfa çekip ekrandakilerle karşılaştırırız: yoksa silinmiştir, içerik farklıysa düzenlenmiştir.
  async function uzlastir() {
    const gorunen = mesajlar.slice() // fetch sürerken eklenenler silinmiş sanılmasın
    if (gorunen.length === 0) return
    let son = Number(gorunen[0].id) - 1
    const gelen = []
    let tam = false
    for (let sayfa = 0; sayfa < 20 && !kapandi; sayfa++) {
      const g = await kaynak.fetch(null, { after: son, limit: SAYFA })
      if (kapandi) return
      gelen.push(...g)
      if (g.length < SAYFA) { tam = true; break }
      son = g.at(-1).id
    }
    if (kapandi) return
    const sinir = tam || gelen.length === 0 ? Infinity : Number(gelen.at(-1).id) // sayfa sınırına takıldıysak ötesine karışma
    const taze = new Map(gelen.map((m) => [m.id, m]))
    // Kopukken kaçan tepki/sabit olayları: gömülü bilgi görünen mesajlar için yeniden yazılır
    const gorunenIdler = new Set(gorunen.map((m) => m.id))
    const tepkiliGelen = gelen.filter((m) => gorunenIdler.has(m.id) && (gomuluTepkiler(m) || gomuluSabit(m) !== undefined))
    gomuluIsle(tepkiliGelen)
    await eksikProfilleriYukle(tepkiliGelen.flatMap((m) => (gomuluTepkiler(m) ?? []).map((r) => r.user_id)))
    if (kapandi) return
    let degisti = tepkiliGelen.length > 0
    for (const m of gorunen) {
      if (Number(m.id) > sinir) continue
      const t = taze.get(m.id)
      if (!t) { mesajKaldir(m.id, true); degisti = true; continue }
      if (t.content !== m.content || t.edited_at !== m.edited_at) {
        const i = mesajlar.findIndex((x) => x.id === m.id)
        if (i >= 0) { mesajlar[i] = { ...mesajlar[i], ...t }; degisti = true }
      }
    }
    if (degisti) yenidenCiz()
  }

  // Eksik yazar profillerini tek sorguda getirir.
  // Yazarlar ve tepki verenler birlikte (rozet ipucundaki adlar için).
  async function profilleriYukle(yeniler) {
    const kimler = yeniler.flatMap((m) => [m.author_id, ...(gomuluTepkiler(m) ?? []).map((r) => r.user_id)])
    await eksikProfilleriYukle(kimler)
  }
  async function eksikProfilleriYukle(idListesi) {
    const eksik = [...new Set(idListesi)].filter((id) => id && !profiller.has(id))
    if (eksik.length === 0) return
    try {
      for (const p of await fetchProfiles(eksik)) profiller.set(p.id, p)
    } catch { /* profil gelmezse "Bilinmeyen" görünür */ }
  }

  // Mesajları ekler (tekrarları atar). Başa/sona eklemeye göre kaydırmayı korur.
  // tur: 'basa' (eskiler), 'sona' (yeni mesaj), 'ilk' (ilk yükleme)
  // 'ilk' ve 'basa' hiç yeni mesaj getirmese de liste yeniden çizilir: "kanalın başlangıcı"
  // bloğu (boş kanal, ya da en eski sayfanın boş gelmesi) ancak böyle görünür.
  async function ekle(yeniler, tur) {
    yeniler = yeniler.filter((m) => !idler.has(m.id))
    if (yeniler.length === 0 && tur === 'sona') return
    await profilleriYukle(yeniler)
    if (kapandi) return
    // await sırasında başka yoldan eklenmiş olabilir; tekrar süz
    yeniler = yeniler.filter((m) => !idler.has(m.id))
    for (const m of yeniler) idler.add(m.id)
    gomuluIsle(yeniler)
    const altta = enAltta()
    const eskiYukseklik = liste.scrollHeight
    // Hangi sırayla gelirse gelsin liste id'ye (bigint, artan) göre sıralı kalır
    mesajlar = [...mesajlar, ...yeniler].sort((a, b) => Number(a.id) - Number(b.id))
    ciz()
    if (tur === 'basa') liste.scrollTop += liste.scrollHeight - eskiYukseklik // olduğu yerde kal
    else if (altta || tur === 'ilk') {
      liste.scrollTop = liste.scrollHeight // sadece alttaysa in
      altaYapisik = true
    }
    if (tur !== 'basa' && altaYapisik && !kapandi) onBottom?.(mesajlar.at(-1)?.id ?? null)
    // Listede olmayan yanıt hedefleri: alıntı önce "…", gelince yeniden çizilir
    if (yeniler.some((m) => m.reply_to != null && !bul(m.reply_to) && !yanitHedefleri.has(m.reply_to))) {
      yanitHedefleriniYukle(yeniler).then(() => { if (!kapandi) yenidenCiz() })
    }
  }

  // Yukarı kaydırınca 50 eski mesaj
  async function eskileriYukle() {
    if (yukleniyor || !eskiVar || mesajlar.length === 0) return
    yukleniyor = true
    try {
      const gelen = await kaynak.fetch(mesajlar[0].id, { limit: SAYFA })
      if (kapandi) return
      if (gelen.length < SAYFA) eskiVar = false
      await ekle(gelen, 'basa')
    } catch {
      if (!kapandi) toast('Eski mesajlar yüklenemedi. Biraz sonra tekrar dene.', 'hata')
    } finally {
      yukleniyor = false
    }
  }
  liste.addEventListener('scroll', () => {
    // Boyut değişirken gelen olay: kullanıcı kaydırmadı, konumu gözlemci düzeltecek
    if (olculenYukseklik !== null && liste.clientHeight !== olculenYukseklik) return
    altaYapisik = enAltta()
    if (altaYapisik) onBottom?.(mesajlar.at(-1)?.id ?? null)
    if (liste.scrollTop <= 0) eskileriYukle()
  })
  gozlemci?.observe(liste)

  // Gönderme
  let gonderiyor = false
  function sayacGuncelle() {
    const n = kutu.value.trim().length
    if (n > MAX_UZUNLUK) uyari.textContent = 'Mesaj en fazla 2000 karakter olabilir'
    else if (n > 1800) uyari.textContent = `${n} / ${MAX_UZUNLUK}`
    else uyari.textContent = ''
    uyari.classList.toggle('over', n > MAX_UZUNLUK)
  }
  // Yazıyor göstergesi: kutuya yazınca typing(), kutu boşalınca ya da mesaj gidince stopped()
  // Engelde kutu yok, karşı taraf da yazamaz: konuya hiç katılmayız (boş takipçi).
  const yazanTakibi = yazabilir
    ? kaynak.joinTyping({
        selfId: profile.id,
        selfName: profile.username,
        onChange: (adlar) => { if (!kapandi) yaziyorCiz(adlar) },
      })
    : { typing() {}, stopped() {}, clear() {}, leave: async () => {} }
  function yaziyorCiz(adlar) {
    yaziyor.textContent = ''
    if (adlar.length === 0) return
    const kalin = (ad) => { const b = document.createElement('strong'); b.textContent = ad; return b }
    const yaz = document.createElement('span')
    if (adlar.length >= 4) yaz.append('Birkaç kişi yazıyor')
    else if (adlar.length === 1) yaz.append(kalin(adlar[0]), ' yazıyor')
    else if (adlar.length === 2) yaz.append(kalin(adlar[0]), ' ve ', kalin(adlar[1]), ' yazıyor')
    else yaz.append(kalin(adlar[0]), ', ', kalin(adlar[1]), ' ve ', kalin(adlar[2]), ' yazıyor')
    const noktalar = document.createElement('span')
    noktalar.className = 'typing-dots'
    noktalar.textContent = '…'
    yaziyor.append(yaz, noktalar)
  }
  kutu.addEventListener('input', () => {
    if (kutu.value.trim() === '') yazanTakibi.stopped()
    else yazanTakibi.typing()
  })
  kutu.addEventListener('input', sayacGuncelle)
  async function gonder() {
    if (gonderiyor) return
    gonderiyor = true
    try {
      const yanitlanan = yanit
      const sonuc = yanitlanan ? await kaynak.send(kutu.value, { replyTo: yanitlanan.id }) : await kaynak.send(kutu.value)
      if (!sonuc.ok) {
        if (sonuc.warning) uyari.textContent = sonuc.warning
        return
      }
      kutu.value = '' // sadece başarılı gönderimden sonra temizle
      if (yanit === yanitlanan) yanitIptal()
      yazanTakibi.stopped()
      sayacGuncelle()
      await ekle([sonuc.message], 'sona')
      if (!kapandi) { liste.scrollTop = liste.scrollHeight; altaYapisik = true } // kendi mesajımızda hep en alta in
    } catch (e) {
      // DM'de engel (veritabanı reddetti): genel "tekrar dene" yerine nedenini söyle
      toast(e?.message === GONDEREMEZSIN ? GONDEREMEZSIN : 'Mesaj gönderilemedi. Tekrar dene.', 'hata')
    } finally {
      gonderiyor = false
    }
  }
  kutu.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return // @ öneri listesi tuşu kullandı (seçim/gezinme)
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); gonder() }
    // Esc yanıtı iptal eder (yanıt varken)
    else if (e.key === 'Escape' && yanit) { e.preventDefault(); yanitIptal() }
    // Kutu boşken ↑: son kendi mesajını düzenlemeye aç (Discord alışkanlığı)
    else if (yazabilir && e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && kutu.value === '') {
      const son = mesajlar.findLast((m) => duzenlenebilir(m))
      if (son) { e.preventDefault(); duzenleBaslat(son.id) }
    }
  })

  // Anlık mesajlar
  // getLastId: yeniden bağlanınca en son gördüğümüz mesajdan sonrası getirilsin (kopukken gelenler)
  const abonelikiKapat = kaynak.subscribe({
    onInsert: (m) => {
      if (kapandi) return
      yazanTakibi.clear(m.author_id) // mesajı gelen kişinin "yazıyor" göstergesi hemen kalkar
      ekle([m], 'sona')
    },
    onUpdate: (m) => { // düzenlenen yerinde değişir, silinen listeden kalkar
      if (kapandi) return
      if (m.deleted_at) mesajKaldir(m.id)
      else mesajGuncelle(m)
    },
    onReconnect: () => { uzlastir().catch(() => { /* bir sonraki bağlanışta yine denenir */ }) },
    getLastId: () => mesajlar.at(-1)?.id ?? null,
  })

  // İlk yükleme
  kaynak.fetch(null, { limit: SAYFA })
    .then(async (gelen) => {
      if (kapandi) return // bu arada kanal değişti
      if (gelen.length < SAYFA) eskiVar = false
      await ekle(gelen, 'ilk')
    })
    .catch(() => { if (!kapandi) toast('Mesajlar yüklenemedi. İnternetini kontrol et.', 'hata') })

  return {
    // Okunmamış sayacı için: kullanıcı en altta mı, en son mesaj hangisi
    isAtBottom: () => enAltta(),
    getLastId: () => mesajlar.at(-1)?.id ?? null,
    // Profil değişince kendi mesajlarımız tazelensin
    updateProfile(p) { profile = p; profiller.set(p.id, p); ciz() },
    // Kanal başka istemcide yeniden adlandırıldı: yalnız adın görüldüğü yerler güncellenir
    // (yazılan taslak, açık düzenleme kutusu ve kaydırma konumu bozulmaz; liste yeniden çizilmez)
    renameChannel(ad) {
      if (dm) return
      adi = ad
      kanalAdi.textContent = ad
      kutu.placeholder = `#${ad} kanalına mesaj yaz…`
      const baslangic = liste?.querySelector?.('.channel-start h2')
      if (baslangic) baslangic.textContent = `#${ad} kanalına hoş geldin!`
    },
    // Sunucu üyeleri yüklendi/değişti: @ etiketleri yeniden çizilir (kanalda)
    setMembers(liste) {
      if (dm) return
      const anahtar = (l) => l.map((u) => `${u.id}:${u.username}`).join('\n')
      const ayni = anahtar(liste ?? []) === anahtar(uyeler)
      uyeler = liste ?? []
      if (!ayni) yenidenCiz() // adlar değişmediyse boşuna çizme
    },
    // DM: karşı tarafın durumu değişti (başlıktaki nokta). Kanalda bir şey yapmaz.
    setPeerStatus(durum) {
      if (!dm) return
      const yeni = baslikAvatari(durum)
      diyez.replaceWith(yeni)
      diyez = yeni
    },
    // Canlı tepki olayı (app.js: server:/user: konusundaki "tepki"). Başka konuşmanınkini yok sayar.
    // p: { channel_id | thread_id, message_id, emoji, user_id, islem }
    applyReaction(p) {
      if (kapandi || (p?.channel_id ?? p?.thread_id) !== kaynak.id) return
      if (!tepkiIsle(p)) return
      // Adı bilinmeyen kişi önce "N kişi daha"ya katılır; profil gelince yeniden çizilir
      if (p.user_id && !profiller.has(p.user_id)) eksikProfilleriYukle([p.user_id]).then(() => { if (!kapandi) yenidenCiz() })
      yenidenCiz()
    },
    // Canlı sabit olayı ("sabit"): { channel_id | thread_id, message_id, islem }
    applyPin(p) {
      if (kapandi || (p?.channel_id ?? p?.thread_id) !== kaynak.id) return
      if (sabitIsle(p.message_id, p.islem === 'INSERT') && bul(p.message_id)) yenidenCiz()
    },
    destroy() { kapandi = true; clearTimeout(vurguZamani); oneri?.destroy(); gozlemci?.disconnect(); abonelikiKapat(); yazanTakibi.leave().catch(() => {}); if (headerHost) baslik.remove() },
  }
}
