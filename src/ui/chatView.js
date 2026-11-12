// Yazılı kanal sohbeti: mesaj listesi, sonsuz kaydırma, yazı kutusu, anlık mesajlar.
import { fetchMessages, sendMessage, editMessage, deleteMessage, subscribeMessages, fetchProfiles, MAX_UZUNLUK, SAYFA } from '../data/messages.js'
import { toast } from './layout.js'
import { linkliMetin } from './links.js'
import { joinTyping } from '../data/typing.js'
import { avatarTextColor } from './avatarColor.js'
import { makeProfileOpener } from './profileOpener.js'
import { eylemCubugu, duzenlendiEtiketi, duzenlemeKutusu, silmeOnayi } from './messageActions.js'

const BES_DAKIKA = 5 * 60 * 1000

const saatBicimi = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' })
const tarihBicimi = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

// Bir mesajı çizer. Kullanıcı yazısı HER ZAMAN textContent ile basılır (güvenlik).
// grouped: true ise başlık (avatar/ad/saat) çizilmez; avatarın yerinde, üzerine gelince görünen küçük saat olur.
// Metindeki http/https adresleri tıklanır link olur (links.js; yine innerHTML yok).
// izin: { duzenle, sil } -> sağ üstteki simgeler; tik: { onEdit(), onDelete(shiftBasili) }.
// editor: verilirse mesaj metni yerine bu düzenleme kutusu (öğe) konur.
export function renderMessage(msg, profile, { grouped = false, izin = null, tik = null, editor = null } = {}) {
  const p = profile ?? { username: 'Bilinmeyen', color: '#8d93a1', avatar_url: null }
  const el = document.createElement('div')
  el.className = 'message' + (grouped ? ' grouped' : '')
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
    govde.appendChild(ust)
  }
  const metin = document.createElement('div')
  metin.className = 'msg-text'
  if (editor) {
    el.classList.add('editing')
    govde.appendChild(editor)
  } else {
    metin.appendChild(linkliMetin(msg.content))
    // Gruplanmış satırda görünür saat yok (yalnız hover'da); etiket bu durumda metnin sonunda kalır
    if (msg.edited_at && grouped) metin.appendChild(duzenlendiEtiketi(msg.edited_at))
    govde.appendChild(metin)
  }
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
// channel: {id, name}, profile: giriş yapan kullanıcının profili.
// headerActions: başlığın sağına konacak düğmeler (ör. "Üyeler" düğmesi; app.js verir).
// headerHost verilirse başlık container'a değil ona konur (app.js: başlık görüntü bölmesinin üstünde durur).
// isOwner: giriş yapan kişi bu sunucunun sahibi mi (sahip başkasının mesajını da silebilir; app.js verir).
// onBottom(sonMesajId): kullanıcı en alta indi ya da en alttayken mesaj geldi (app.js okundu işaretler).
export function mountChat(container, { channel, profile, isOwner = false, headerActions = [], headerHost = null, onBottom = null }) {
  let mesajlar = [] // eskiden yeniye
  const idler = new Set() // aynı mesaj iki kez eklenmesin
  const profiller = new Map([[profile.id, profile]])
  let kapandi = false
  let eskiVar = true // daha eski mesaj olabilir mi
  let yukleniyor = false
  // Açık düzenleme: { id, ed }. ed (düzenleme kutusu öğesi) liste yeniden çizilince AYNEN yeniden konur,
  // böylece yeni mesaj ya da canlı güncelleme gelse de yazılan kaybolmaz.
  let duzenle = null

  container.innerHTML = ''
  if (headerHost) headerHost.innerHTML = ''
  const baslik = document.createElement('header')
  baslik.className = 'main-header'
  // # simgesi süs olduğu için ekran okuyucudan gizli; kanal adı ayrı kutuda
  const diyez = document.createElement('span')
  diyez.className = 'header-hash'
  diyez.setAttribute('aria-hidden', 'true')
  diyez.textContent = '#'
  const kanalAdi = document.createElement('span')
  kanalAdi.className = 'header-name'
  let adi = channel.name // kanal yeniden adlandırılınca güncellenir (bkz. renameChannel)
  kanalAdi.textContent = adi
  baslik.append(diyez, kanalAdi)
  if (headerActions.length) {
    // Sağdaki düğmeler kutusu (CSS margin-left: auto ile sağa yaslar)
    const sag = document.createElement('div')
    sag.className = 'header-actions'
    sag.append(...headerActions)
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
  kutu.placeholder = `#${adi} kanalına mesaj yaz…`
  // "yazıyor…" satırı: yüksekliği sabit (boşken de yer tutar), aria-live YOK (sürekli konuşmasın)
  const yaziyor = document.createElement('div')
  yaziyor.className = 'typing-line'
  alt.append(uyari, kutu, yaziyor)
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

  // Kanalın başlangıcı bloğu: büyük #, "#kanal kanalına hoş geldin!" ve kısa yazı.
  // Yalnız en eski mesaj yüklendiyse (daha eskisi yoksa) listenin en tepesine konur.
  function baslangicBlogu() {
    const blok = document.createElement('div')
    blok.className = 'channel-start'
    const simge = document.createElement('div')
    simge.className = 'channel-start-icon'
    simge.setAttribute('aria-hidden', 'true')
    simge.textContent = '#'
    const h = document.createElement('h2')
    h.textContent = `#${adi} kanalına hoş geldin!` // textContent: kanal adı HTML olarak çalışmaz
    const p = document.createElement('p')
    // Henüz mesaj yoksa ilk adımı söyle; mesaj varsa yalnız başlangıç olduğunu belirt
    p.textContent = mesajlar.length === 0 ? 'Bu kanalın başlangıcı. İlk mesajı sen yaz.' : 'Bu kanalın başlangıcı.'
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
        onceki.author_id === m.author_id &&
        new Date(m.created_at) - new Date(onceki.created_at) <= BES_DAKIKA
      liste.appendChild(renderMessage(m, profiller.get(m.author_id), {
        grouped: gruplu,
        izin: { duzenle: m.author_id === profile.id, sil: m.author_id === profile.id || isOwner },
        tik: { onEdit: () => duzenleBaslat(m.id), onDelete: (shift) => silIste(m.id, shift) },
        editor: duzenle?.id === m.id ? duzenle.ed.el : null,
      }))
      onceki = m
    }
    if (duzenle) duzenle.ed.boyutla()
    if (geriOdak?.kutu && duzenle) {
      duzenle.ed.kutu.focus({ preventScroll: true })
      try { duzenle.ed.kutu.setSelectionRange(geriOdak.bas, geriOdak.son) } catch { /* sorun değil */ }
    } else if (geriOdak?.act) {
      liste.querySelector(`.message[data-id="${geriOdak.id}"] [data-act="${geriOdak.act}"]`)?.focus({ preventScroll: true })
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

  function duzenleBaslat(id) {
    const m = bul(id)
    if (!m || m.author_id !== profile.id || kapandi) return
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
      const sonuc = await editMessage(id, metin)
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
    const vardi = mesajlar.length
    mesajlar = mesajlar.filter((m) => m.id !== id)
    if (duzenle?.id === id) { duzenle = null; toast('Düzenlediğin mesaj silindi.') }
    if (!yenidenCizme && mesajlar.length !== vardi) yenidenCiz()
  }

  const siliniyor = new Set() // silme isteği süren mesaj id'leri (çift Shift+tık tek istek atsın)

  async function silYap(m) {
    if (siliniyor.has(m.id)) return null
    siliniyor.add(m.id)
    try { await deleteMessage(m.id) } catch { return 'Mesaj silinemedi. Tekrar dene.' } finally { siliniyor.delete(m.id) }
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
      if (!kapandi && !bul(id)) kutu.focus()
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
      const g = await fetchMessages(channel.id, { after: son, limit: SAYFA })
      if (kapandi) return
      gelen.push(...g)
      if (g.length < SAYFA) { tam = true; break }
      son = g.at(-1).id
    }
    if (kapandi) return
    const sinir = tam || gelen.length === 0 ? Infinity : Number(gelen.at(-1).id) // sayfa sınırına takıldıysak ötesine karışma
    const taze = new Map(gelen.map((m) => [m.id, m]))
    let degisti = false
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
  async function profilleriYukle(yeniler) {
    const eksik = [...new Set(yeniler.map((m) => m.author_id))].filter((id) => !profiller.has(id))
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
  }

  // Yukarı kaydırınca 50 eski mesaj
  async function eskileriYukle() {
    if (yukleniyor || !eskiVar || mesajlar.length === 0) return
    yukleniyor = true
    try {
      const gelen = await fetchMessages(channel.id, { before: mesajlar[0].id, limit: SAYFA })
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
  const yazanTakibi = joinTyping(channel.id, {
    selfId: profile.id,
    selfName: profile.username,
    onChange: (adlar) => { if (!kapandi) yaziyorCiz(adlar) },
  })
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
      const sonuc = await sendMessage(channel.id, kutu.value, profile.id)
      if (!sonuc.ok) {
        if (sonuc.warning) uyari.textContent = sonuc.warning
        return
      }
      kutu.value = '' // sadece başarılı gönderimden sonra temizle
      yazanTakibi.stopped()
      sayacGuncelle()
      await ekle([sonuc.message], 'sona')
      if (!kapandi) { liste.scrollTop = liste.scrollHeight; altaYapisik = true } // kendi mesajımızda hep en alta in
    } catch {
      toast('Mesaj gönderilemedi. Tekrar dene.', 'hata')
    } finally {
      gonderiyor = false
    }
  }
  kutu.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); gonder() }
    // Kutu boşken ↑: son kendi mesajını düzenlemeye aç (Discord alışkanlığı)
    else if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && kutu.value === '') {
      const son = mesajlar.findLast((m) => m.author_id === profile.id)
      if (son) { e.preventDefault(); duzenleBaslat(son.id) }
    }
  })

  // Anlık mesajlar
  // getLastId: yeniden bağlanınca en son gördüğümüz mesajdan sonrası getirilsin (kopukken gelenler)
  const abonelikiKapat = subscribeMessages(channel.id, (m) => {
    if (kapandi) return
    yazanTakibi.clear(m.author_id) // mesajı gelen kişinin "yazıyor" göstergesi hemen kalkar
    ekle([m], 'sona')
  }, {
    onUpdate: (m) => { // düzenlenen yerinde değişir, silinen listeden kalkar
      if (kapandi) return
      if (m.deleted_at) mesajKaldir(m.id)
      else mesajGuncelle(m)
    },
    onReconnect: () => { uzlastir().catch(() => { /* bir sonraki bağlanışta yine denenir */ }) },
    getLastId: () => mesajlar.at(-1)?.id ?? null,
  })

  // İlk yükleme
  fetchMessages(channel.id, { limit: SAYFA })
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
      adi = ad
      kanalAdi.textContent = ad
      kutu.placeholder = `#${ad} kanalına mesaj yaz…`
      const baslangic = liste?.querySelector?.('.channel-start h2')
      if (baslangic) baslangic.textContent = `#${ad} kanalına hoş geldin!`
    },
    destroy() { kapandi = true; gozlemci?.disconnect(); abonelikiKapat(); yazanTakibi.leave().catch(() => {}); if (headerHost) baslik.remove() },
  }
}
