// Yazılı kanal sohbeti: mesaj listesi, sonsuz kaydırma, yazı kutusu, anlık mesajlar.
import { fetchMessages, sendMessage, subscribeMessages, fetchProfiles, MAX_UZUNLUK, SAYFA } from '../data/messages.js'
import { toast } from './layout.js'

const BES_DAKIKA = 5 * 60 * 1000

const saatBicimi = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' })
const tarihBicimi = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

// Bir mesajı çizer. Kullanıcı yazısı HER ZAMAN textContent ile basılır (güvenlik).
// grouped: true ise başlık (avatar/ad/saat) çizilmez.
export function renderMessage(msg, profile, { grouped = false } = {}) {
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
    av.style.background = p.color
    el.appendChild(av)
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
    const saat = document.createElement('span')
    saat.className = 'msg-time'
    saat.textContent = saatBicimi.format(new Date(msg.created_at))
    ust.append(ad, saat)
    govde.appendChild(ust)
  }
  const metin = document.createElement('div')
  metin.className = 'msg-text'
  metin.textContent = msg.content
  govde.appendChild(metin)
  el.appendChild(govde)
  return el
}

// Aynı günün anahtarı (gün değişimini bulmak için)
const gunAnahtari = (iso) => new Date(iso).toDateString()

// Sohbeti container içine kurar. Dönen destroy() abonelikleri kapatır.
// channel: {id, name}, profile: giriş yapan kullanıcının profili.
export function mountChat(container, { channel, profile }) {
  let mesajlar = [] // eskiden yeniye
  const idler = new Set() // aynı mesaj iki kez eklenmesin
  const profiller = new Map([[profile.id, profile]])
  let kapandi = false
  let eskiVar = true // daha eski mesaj olabilir mi
  let yukleniyor = false

  container.innerHTML = ''
  const baslik = document.createElement('header')
  baslik.className = 'main-header'
  baslik.textContent = `#${channel.name}`
  const liste = document.createElement('div')
  liste.className = 'message-list'
  const alt = document.createElement('div')
  alt.className = 'composer'
  const uyari = document.createElement('div')
  uyari.className = 'composer-warning'
  const kutu = document.createElement('textarea')
  kutu.rows = 1
  kutu.placeholder = `#${channel.name} kanalına mesaj yaz…`
  alt.append(uyari, kutu)
  container.append(baslik, liste, alt)

  const enAltta = () => liste.scrollHeight - liste.scrollTop - liste.clientHeight < 40

  // "Alta yapışık": kullanıcı en alttaysa liste boyu değişince de (ör. üstte görüntü bölmesi
  // açılıp kapanınca, pencere boyutlanınca) en altta kalsın. Kaydırınca güncellenir.
  let altaYapisik = true
  const gozlemci = globalThis.ResizeObserver
    ? new ResizeObserver(() => { if (altaYapisik && !kapandi) liste.scrollTop = liste.scrollHeight })
    : null // eski tarayıcı / test ortamı: yalnız mesaj gelince inilir

  // Listeyi baştan çizer (ardışık mesaj gruplaması ve gün çizgileri burada).
  function ciz() {
    liste.innerHTML = ''
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
      liste.appendChild(renderMessage(m, profiller.get(m.author_id), { grouped: gruplu }))
      onceki = m
    }
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
  async function ekle(yeniler, tur) {
    yeniler = yeniler.filter((m) => !idler.has(m.id))
    if (yeniler.length === 0) return
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
      if (!kapandi) toast('Eski mesajlar yüklenemedi')
    } finally {
      yukleniyor = false
    }
  }
  liste.addEventListener('scroll', () => {
    altaYapisik = enAltta()
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
      sayacGuncelle()
      await ekle([sonuc.message], 'sona')
      if (!kapandi) { liste.scrollTop = liste.scrollHeight; altaYapisik = true } // kendi mesajımızda hep en alta in
    } catch {
      toast('Mesaj gönderilemedi')
    } finally {
      gonderiyor = false
    }
  }
  kutu.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); gonder() }
  })

  // Anlık mesajlar
  // getLastId: yeniden bağlanınca en son gördüğümüz mesajdan sonrası getirilsin (kopukken gelenler)
  const abonelikiKapat = subscribeMessages(channel.id, (m) => { if (!kapandi) ekle([m], 'sona') }, {
    getLastId: () => mesajlar.at(-1)?.id ?? null,
  })

  // İlk yükleme
  fetchMessages(channel.id, { limit: SAYFA })
    .then(async (gelen) => {
      if (kapandi) return // bu arada kanal değişti
      if (gelen.length < SAYFA) eskiVar = false
      await ekle(gelen, 'ilk')
    })
    .catch(() => { if (!kapandi) toast('Mesajlar yüklenemedi') })

  return {
    // Profil değişince kendi mesajlarımız tazelensin
    updateProfile(p) { profile = p; profiller.set(p.id, p); ciz() },
    destroy() { kapandi = true; gozlemci?.disconnect(); abonelikiKapat() },
  }
}
