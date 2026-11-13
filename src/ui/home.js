// Ana sayfa: sol sütun (Arkadaşlar satırı + ÖZEL MESAJLAR listesi) ve orta alandaki Arkadaşlar sayfası.
//
//   Sol sütun                 Orta alan (Arkadaşlar sayfası)
//   ┌──────────────────┐     ┌──────────────────────────────────────────────────────────┐
//   │ 👥 Arkadaşlar    │     │ 👥 Arkadaşlar │ Çevrimiçi  Tümü  Bekleyen(2)  Engellenen  [Arkadaş ekle] │
//   │ ÖZEL MESAJLAR    │     ├──────────────────────────────────────────────────────────┤
//   │ (A)● ali     3 × │     │ ÇEVRİMİÇİ — 1                                            │
//   │ (V)● veli      × │     │ (A)● ali  Çevrimiçi                             💬  ⋯    │
//   └──────────────────┘     └──────────────────────────────────────────────────────────┘
//
// Veri ve işler app.js'tedir; burada yalnız çizim ve tıklamalar. Kullanıcı yazıları textContent ile basılır.
import { avatarWithDot } from './memberList.js'
import { STATUS_LABELS } from './profileCard.js'
import { makeProfileOpener } from './profileOpener.js'
import { sayiYazisi } from './unread.js'
import { openMenu, closeMenu, menuAcikMi, herhangiMenuAcikMi, menuKapaninca } from './serverMenu.js'
import { createModalShell } from './modal.js'
import { usersIcon, messageIcon, moreIcon, checkIcon, closeIcon } from './icons.js'

// Spec §1'in metinleri
export const HOME_TEXTS = {
  arkadaslar: 'Arkadaşlar',
  ozelMesajlar: 'ÖZEL MESAJLAR',
  arkadasEkle: 'Arkadaş ekle',
  kutu: 'Kullanıcı adını yaz',
  gonder: 'İstek gönder',
  gonderildi: 'İstek gönderildi.',
  arkadasOldunuz: 'Artık arkadaşsınız.', // karşı taraf zaten istemişti: iki istek eşleşti
  bosCevrimici: 'Şu an çevrimiçi arkadaşın yok.',
  bosTumu: 'Henüz arkadaşın yok. Kullanıcı adıyla ekleyebilirsin.',
  bosBekleyen: 'Bekleyen istek yok.',
  bosEngellenen: 'Engellediğin kimse yok.',
  gelenIstek: 'Gelen istek',
  gidenIstek: 'Giden istek',
  yuklenemedi: 'Arkadaş listesi yüklenemedi. Bağlantını kontrol et.',
  genelHata: 'Bir şeyler ters gitti. İnternetini kontrol edip tekrar dene.',
}

// Sekmeler: anahtar -> başlık
export const FRIEND_TABS = [
  ['online', 'Çevrimiçi'],
  ['all', 'Tümü'],
  ['pending', 'Bekleyen'],
  ['blocked', 'Engellenen'],
]

// Kişinin durumu varlıktan (presence): yoksa çevrimdışı
export function kisiDurumu(presence, id) {
  return presence?.get?.(id)?.status ?? 'offline'
}

// Satırdaki durum yazısı: kişinin durum mesajı varsa o, yoksa durum adı ("Çevrimiçi", "Rahatsız etmeyin")
export function durumYazisi(presence, id) {
  const v = presence?.get?.(id)
  if (v?.statusText) return v.statusText
  return STATUS_LABELS[v?.status ?? 'offline'] ?? STATUS_LABELS.offline
}

// DM listesi son mesaja göre, en yenisi üstte (hiç mesaj yoksa açılış zamanı sayılır)
export function sortDms(dms) {
  const zaman = (t) => String(t.lastMessageAt ?? t.createdAt ?? '')
  return [...dms].sort((a, b) => zaman(b).localeCompare(zaman(a)))
}

// Okunmamış DM toplamı (şeritteki Ana sayfa rozeti)
export function dmUnreadTotal(dms) {
  return dms.reduce((t, d) => t + (d.unread > 0 ? d.unread : 0), 0)
}

function simgeDugme(sinif, etiket, simge) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'icon-btn ' + sinif
  b.setAttribute('aria-label', etiket)
  b.dataset.tip = etiket
  b.appendChild(simge)
  return b
}

function bosYazi(metin) {
  const p = document.createElement('p')
  p.className = 'friends-empty-text'
  p.textContent = metin
  return p
}

// ---------- Sol sütun ----------

// dms: fetchDmList() sonucu (sıralı ya da değil; burada sıralanır). presence: Map<userId, {status, statusText}>
// view: { tur: 'arkadaslar' } | { tur: 'dm', thread }: seçili satır. pending: gelen istek sayısı.
// handlers: { onFriends(), onOpenDm(thread), onHideDm(thread) }
export function renderHomeSidebar({ dms = [], presence = new Map(), view = { tur: 'arkadaslar' }, pending = 0, handlers = {} }) {
  const kok = document.createElement('div')
  kok.className = 'home-nav'

  const arkadas = document.createElement('button')
  arkadas.type = 'button'
  arkadas.className = 'channel-item home-friends' + (view.tur === 'arkadaslar' ? ' selected' : '')
  arkadas.dataset.odak = 'ana-arkadaslar'
  const ad = document.createElement('span')
  ad.textContent = HOME_TEXTS.arkadaslar
  arkadas.append(usersIcon(18), ad)
  if (pending > 0) {
    const say = document.createElement('span')
    say.className = 'home-pending-badge'
    say.textContent = sayiYazisi(pending)
    arkadas.appendChild(say)
    arkadas.setAttribute('aria-label', `${HOME_TEXTS.arkadaslar}, ${sayiYazisi(pending)} bekleyen istek`)
  }
  arkadas.onclick = () => handlers.onFriends?.()

  const baslik = document.createElement('div')
  baslik.className = 'section-head'
  const b = document.createElement('span')
  b.className = 'section-title'
  b.textContent = HOME_TEXTS.ozelMesajlar
  baslik.appendChild(b)

  const liste = document.createElement('div')
  liste.className = 'dm-list'
  const seciliId = view.tur === 'dm' ? view.thread?.id : null
  for (const t of sortDms(dms)) {
    const satir = document.createElement('div')
    satir.className = 'dm-row'
    const okunmamis = t.unread > 0 ? t.unread : 0
    const ac = document.createElement('button')
    ac.type = 'button'
    ac.className = 'dm-item' + (t.id === seciliId ? ' selected' : '') + (okunmamis ? ' unread' : '')
    ac.dataset.odak = `dm-${t.id}`
    if (t.id === seciliId) ac.setAttribute('aria-current', 'page')
    const isim = document.createElement('span')
    isim.className = 'dm-name'
    isim.textContent = t.other.username
    ac.append(avatarWithDot(t.other, kisiDurumu(presence, t.other.id), 'dm-avatar'), isim)
    if (okunmamis) {
      const say = document.createElement('span')
      say.className = 'unread-count'
      say.textContent = sayiYazisi(okunmamis)
      ac.appendChild(say)
      ac.setAttribute('aria-label', `${t.other.username}, ${sayiYazisi(okunmamis)} okunmamış mesaj`)
    }
    ac.onclick = () => handlers.onOpenDm?.(t)
    // × : DM listeden gizlenir (mesajlar silinmez; yeni mesaj gelince geri döner)
    const gizle = simgeDugme('dm-hide', `${t.other.username} konuşmasını gizle`, closeIcon(14))
    gizle.dataset.odak = `dm-gizle-${t.id}`
    gizle.onclick = () => handlers.onHideDm?.(t)
    satir.append(ac, gizle)
    liste.appendChild(satir)
  }
  kok.append(arkadas, baslik, liste)
  return kok
}

// ---------- Orta alan: Arkadaşlar sayfası ----------

// Arkadaşlıktan çıkarma ve engelleme onayı. is() -> Promise; hata olursa pencere açık kalır, metni yazar.
function onayPenceresi(baslik, metin, yazi, is) {
  const p = document.createElement('p')
  p.className = 'confirm-text'
  p.textContent = metin
  return createModalShell({
    baslik,
    govde: [p],
    birincil: {
      yazi,
      tik: async () => {
        try { await is() } catch (e) { return e?.message || HOME_TEXTS.genelHata }
        return null
      },
    },
    tehlikeli: true,
  })
}

// Fare düğmesi şu an basılı mı? (ertelenmiş çizim, tıklamanın ortasında düğmeyi değiştirmesin)
let fareBasili = false
if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', () => { fareBasili = true }, true)
  document.addEventListener('mouseup', () => { fareBasili = false }, true)
}

// Sayfa bir kez kurulur (yazılan kullanıcı adı ve seçili sekme kaybolmasın); veri gelince update() çağrılır.
// handlers: { onMessage(kisi), onSend(kullaniciAdi) -> Promise<'sent'|'accepted'>, onAccept(kisi),
//   onDecline(kisi) (red ve iptal), onRemove(kisi) -> Promise, onBlock(kisi) -> Promise, onUnblock(kisi) }
// Dönen: { header, body, update(durum), showTab(sekme), tab() }
//   durum: { friends, incoming, outgoing, blocked, presence, error }
//   (friends null: henüz yüklenmedi; error true: yüklenemedi)
export function createFriendsPage({ handlers = {} } = {}) {
  let sekme = 'online' // 'online' | 'all' | 'pending' | 'blocked' | 'add'
  let durum = { friends: null, incoming: [], outgoing: [], blocked: [], presence: new Map(), error: false }

  // ---- Üst şerit: başlık, sekmeler, Arkadaş ekle ----
  const header = document.createElement('header')
  header.className = 'main-header friends-header'
  const baslik = document.createElement('span')
  baslik.className = 'friends-title'
  const baslikYazi = document.createElement('span')
  baslikYazi.textContent = HOME_TEXTS.arkadaslar
  baslik.append(usersIcon(20), baslikYazi)
  const sekmeler = document.createElement('div')
  sekmeler.className = 'friends-tabs'
  sekmeler.setAttribute('role', 'tablist')
  sekmeler.setAttribute('aria-label', HOME_TEXTS.arkadaslar)
  const sekmeDugmeleri = new Map()
  for (const [anahtar, ad] of FRIEND_TABS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'friends-tab'
    b.setAttribute('role', 'tab')
    b.dataset.sekme = anahtar
    b.dataset.odak = `sekme-${anahtar}`
    const yazi = document.createElement('span')
    yazi.textContent = ad
    b.appendChild(yazi)
    b.onclick = () => showTab(anahtar)
    sekmeDugmeleri.set(anahtar, b)
    sekmeler.appendChild(b)
  }
  // Bekleyen sekmesinde gelen istek sayısı rozeti
  const bekleyenRozet = document.createElement('span')
  bekleyenRozet.className = 'tab-badge'
  sekmeDugmeleri.get('pending').appendChild(bekleyenRozet)
  const ekleDugme = document.createElement('button')
  ekleDugme.type = 'button'
  ekleDugme.className = 'add-friend-btn'
  ekleDugme.textContent = HOME_TEXTS.arkadasEkle
  ekleDugme.dataset.odak = 'sekme-ekle'
  ekleDugme.onclick = () => showTab('add')
  header.append(baslik, sekmeler, ekleDugme)

  // ---- Gövde: liste ya da Arkadaş ekle kutusu ----
  const body = document.createElement('div')
  body.className = 'friends-page'
  const liste = document.createElement('div')
  liste.className = 'friends-list'

  // Arkadaş ekle kutusu: bir kez kurulur, yazılan ad liste yenilense de kalır
  const ekle = document.createElement('form')
  ekle.className = 'add-friend'
  ekle.noValidate = true
  const ekleBaslik = document.createElement('h2')
  ekleBaslik.className = 'add-friend-title'
  ekleBaslik.textContent = HOME_TEXTS.arkadasEkle
  const satir = document.createElement('div')
  satir.className = 'add-friend-row'
  const kutu = document.createElement('input')
  kutu.type = 'text'
  kutu.maxLength = 20 // kullanıcı adı en fazla 20 karakter (profil penceresiyle aynı)
  kutu.autocomplete = 'off'
  kutu.spellcheck = false
  kutu.placeholder = HOME_TEXTS.kutu
  kutu.setAttribute('aria-label', HOME_TEXTS.kutu)
  const gonder = document.createElement('button')
  gonder.type = 'submit'
  gonder.textContent = HOME_TEXTS.gonder
  satir.append(kutu, gonder)
  const sonuc = document.createElement('p')
  sonuc.className = 'add-friend-result'
  sonuc.setAttribute('role', 'status')
  sonuc.id = 'arkadas-ekle-sonuc'
  kutu.setAttribute('aria-describedby', sonuc.id)
  ekle.append(ekleBaslik, satir, sonuc)

  let gonderiliyor = false
  const dugmeyiAyarla = () => { gonder.disabled = gonderiliyor || kutu.value.trim() === '' }
  function sonucYaz(metin, tur) {
    sonuc.textContent = metin
    sonuc.dataset.tur = tur // 'basari' | 'hata' (renk CSS'ten)
  }
  kutu.addEventListener('input', () => { sonucYaz('', ''); dugmeyiAyarla() })
  ekle.addEventListener('submit', async (e) => {
    e.preventDefault()
    const ad = kutu.value.trim()
    if (!ad || gonderiliyor) return
    gonderiliyor = true
    dugmeyiAyarla()
    try {
      const r = await handlers.onSend?.(ad)
      sonucYaz(r === 'accepted' ? HOME_TEXTS.arkadasOldunuz : HOME_TEXTS.gonderildi, 'basari')
      kutu.value = ''
    } catch (err) {
      sonucYaz(err?.message || HOME_TEXTS.genelHata, 'hata')
    } finally {
      gonderiliyor = false
      dugmeyiAyarla()
    }
  })
  dugmeyiAyarla()

  // ---- Satırlar ----
  function kisiSatiri(kisi, altYazi, dugmeler, cevrimdisi = false) {
    const s = document.createElement('div')
    s.className = 'friend-row' + (cevrimdisi ? ' offline' : '')
    s.dataset.userId = kisi.id
    const av = makeProfileOpener(avatarWithDot(kisi, kisiDurumu(durum.presence, kisi.id), 'member-avatar'), kisi, `profil-arkadas-${kisi.id}`)
    const metin = document.createElement('div')
    metin.className = 'friend-text'
    const ad = document.createElement('div')
    ad.className = 'friend-name'
    ad.textContent = kisi.username
    const alt = document.createElement('div')
    alt.className = 'friend-sub'
    alt.textContent = altYazi
    metin.append(ad, alt)
    const sag = document.createElement('div')
    sag.className = 'friend-actions'
    sag.append(...dugmeler)
    s.append(av, metin, sag)
    return s
  }

  function arkadasDugmeleri(kisi) {
    const mesaj = simgeDugme('friend-message', 'Mesaj gönder', messageIcon())
    mesaj.dataset.odak = `arkadas-mesaj-${kisi.id}`
    mesaj.onclick = () => handlers.onMessage?.(kisi)
    const diger = simgeDugme('friend-more', 'Diğer', moreIcon())
    diger.dataset.odak = `arkadas-diger-${kisi.id}`
    diger.setAttribute('aria-haspopup', 'menu')
    diger.setAttribute('aria-expanded', 'false')
    diger.onclick = () => {
      if (menuAcikMi(diger)) { closeMenu({ returnFocus: true }); return }
      openMenu({
        opener: diger,
        etiket: `${kisi.username} menüsü`,
        yan: 'sag',
        secenekler: [
          {
            yazi: 'Arkadaşlıktan çıkar',
            tehlikeli: true,
            tik: () => onayPenceresi('Arkadaşlıktan çıkar', `${kisi.username} arkadaş listenden çıkarılsın mı?`, 'Çıkar', () => handlers.onRemove?.(kisi)),
          },
          {
            yazi: 'Engelle',
            tehlikeli: true,
            tik: () => onayPenceresi('Engelle', `${kisi.username} engellensin mi? Sana istek gönderemez ve mesaj atamaz.`, 'Engelle', () => handlers.onBlock?.(kisi)),
          },
        ],
      })
    }
    return [mesaj, diger]
  }

  function grupBasligi(ad, sayi) {
    const b = document.createElement('div')
    b.className = 'section-title friends-count'
    b.textContent = `${ad} — ${sayi}`
    return b
  }

  function listeyiCiz() {
    // Baştan çizim odaktaki düğmeyi siler: anahtarını hatırla, çizimden sonra yenisine odaklan
    const odakli = document.activeElement
    const anahtar = liste.contains(odakli) ? odakli.dataset?.odak : null
    liste.replaceChildren()
    const { friends, incoming, outgoing, blocked, presence } = durum
    if (durum.error && !friends) {
      liste.appendChild(bosYazi(HOME_TEXTS.yuklenemedi))
      return
    }
    if (!friends) return // ilk yükleme sürüyor
    if (sekme === 'online' || sekme === 'all') {
      const kisiler = sekme === 'online' ? friends.filter((f) => kisiDurumu(presence, f.id) !== 'offline') : friends
      if (kisiler.length === 0) {
        liste.appendChild(bosYazi(sekme === 'online' ? HOME_TEXTS.bosCevrimici : HOME_TEXTS.bosTumu))
        if (sekme === 'all') {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = 'friends-empty-add'
          b.textContent = HOME_TEXTS.arkadasEkle
          b.onclick = () => showTab('add')
          liste.appendChild(b)
        }
      } else {
        liste.appendChild(grupBasligi(sekme === 'online' ? 'Çevrimiçi' : 'Tümü', kisiler.length))
        for (const k of kisiler) {
          const d = kisiDurumu(presence, k.id)
          liste.appendChild(kisiSatiri(k, durumYazisi(presence, k.id), arkadasDugmeleri(k), d === 'offline'))
        }
      }
    } else if (sekme === 'pending') {
      const sayi = incoming.length + outgoing.length
      if (sayi === 0) liste.appendChild(bosYazi(HOME_TEXTS.bosBekleyen))
      else {
        liste.appendChild(grupBasligi('Bekleyen', sayi))
        for (const k of incoming) {
          const kabul = simgeDugme('friend-accept', 'Kabul et', checkIcon())
          kabul.dataset.odak = `istek-kabul-${k.id}`
          kabul.onclick = () => handlers.onAccept?.(k)
          const red = simgeDugme('friend-decline', 'Reddet', closeIcon())
          red.dataset.odak = `istek-red-${k.id}`
          red.onclick = () => handlers.onDecline?.(k)
          liste.appendChild(kisiSatiri(k, HOME_TEXTS.gelenIstek, [kabul, red]))
        }
        for (const k of outgoing) {
          const iptal = simgeDugme('friend-cancel', 'İptal', closeIcon())
          iptal.dataset.odak = `istek-iptal-${k.id}`
          iptal.onclick = () => handlers.onDecline?.(k)
          liste.appendChild(kisiSatiri(k, HOME_TEXTS.gidenIstek, [iptal]))
        }
      }
    } else if (sekme === 'blocked') {
      if (blocked.length === 0) liste.appendChild(bosYazi(HOME_TEXTS.bosEngellenen))
      else {
        liste.appendChild(grupBasligi('Engellenen', blocked.length))
        for (const k of blocked) {
          const kaldir = document.createElement('button')
          kaldir.type = 'button'
          kaldir.className = 'secondary friend-unblock'
          kaldir.textContent = 'Engeli kaldır'
          kaldir.dataset.odak = `engel-kaldir-${k.id}`
          kaldir.onclick = () => handlers.onUnblock?.(k)
          liste.appendChild(kisiSatiri(k, 'Engellendi', [kaldir]))
        }
      }
    }
    if (anahtar) [...liste.querySelectorAll('[data-odak]')].find((e) => e.dataset.odak === anahtar)?.focus()
  }

  function sekmeleriIsaretle() {
    for (const [anahtar, b] of sekmeDugmeleri) {
      const secili = anahtar === sekme
      b.setAttribute('aria-selected', String(secili))
      b.classList.toggle('selected', secili)
    }
    ekleDugme.classList.toggle('selected', sekme === 'add')
    ekleDugme.setAttribute('aria-pressed', String(sekme === 'add'))
    const gelen = durum.incoming?.length ?? 0
    bekleyenRozet.textContent = gelen > 0 ? sayiYazisi(gelen) : ''
    bekleyenRozet.hidden = gelen === 0
    sekmeDugmeleri.get('pending').setAttribute('aria-label', gelen > 0 ? `Bekleyen, ${sayiYazisi(gelen)} gelen istek` : 'Bekleyen')
  }

  function showTab(yeni) {
    const degisti = yeni !== sekme
    sekme = yeni
    sekmeleriIsaretle()
    if (sekme === 'add') {
      if (body.firstChild !== ekle) body.replaceChildren(ekle)
      if (degisti) kutu.focus()
    } else {
      if (body.firstChild !== liste) body.replaceChildren(liste)
      listeyiCiz()
    }
  }

  function update(yeni) {
    durum = { ...durum, ...yeni }
    sekmeleriIsaretle()
    if (sekme === 'add') return
    // Açık bir ⋯ menüsü varken liste baştan çizilirse menünün düğmesi ve odak kaybolur:
    // çizimi menü kapanana kadar ertele (veri durumda güncel; kapanınca son haliyle çizilir)
    if (herhangiMenuAcikMi()) {
      if (!cizimBekliyor) {
        cizimBekliyor = true
        // Kapanış, tıklamanın ortasında olabilir (dışarı basış, başka menü açma): fare basılıysa tıklama
        // bitince, değilse olay bitince çizilir; o arada başka menü açıldıysa yine ertelenir
        menuKapaninca(() => {
          let yapildi = false
          const ciz = () => {
            if (yapildi) return
            yapildi = true
            document.removeEventListener('mouseup', ciz)
            document.removeEventListener('click', ciz, true)
            setTimeout(() => { cizimBekliyor = false; if (sekme !== 'add') update({}) }, 0)
          }
          if (fareBasili) { document.addEventListener('mouseup', ciz); document.addEventListener('click', ciz, true) } else ciz()
        })
      }
      return
    }
    listeyiCiz()
  }
  let cizimBekliyor = false

  showTab('online')
  return { header, body, update, showTab, tab: () => sekme }
}
