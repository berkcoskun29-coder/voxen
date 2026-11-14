// Grup DM arayüzü (v0.9.0): grup rozeti, "Grup oluştur" / "Üye ekle" / "Grubun adını değiştir" pencereleri,
// "Gruptan ayrıl" onayı ve grup açıkken sağ paneldeki üye listesi. Veri ve işler app.js'te (data/groups.js).
// Kullanıcı yazıları textContent ile basılır; renkler tema değişkenlerinden (kişi rengi profilden gelir).
import { createModalShell, formAlani } from './modal.js'
import { avatarWithDot } from './memberList.js'
import { avatarTextColor } from './avatarColor.js'
import { makeProfileOpener } from './profileOpener.js'
import { rozetUyeleri, grupAdi, GRUP_EN_AZ, GRUP_EN_FAZLA, GRUP_ADI_MAX } from '../data/groups.js'

export const GRUP_METINLERI = {
  olustur: 'Grup oluştur',
  olusturBaslik: 'Grup oluştur',
  adEtiket: 'Grup adı (isteğe bağlı)',
  secin: 'Arkadaşlarını seç',
  arkadasYok: 'Grup kurmak için en az iki arkadaşın olmalı.',
  enAz: 'En az 2 arkadaşını seç (kendin dahil 3 kişi).',
  enFazla: 'Grup en fazla 10 kişi olabilir.',
  uyeEkle: 'Üye ekle',
  ekle: 'Ekle',
  eklenecekYok: 'Eklenebilecek arkadaşın yok.',
  adDegistir: 'Grubun adını değiştir',
  adKaydet: 'Kaydet',
  adIpucu: 'Boş bırakırsan üyelerin adları görünür.',
  sessizeAl: 'Sessize al',
  sesiAc: 'Sesi aç',
  ayril: 'Gruptan ayrıl',
  ayrilOnay: (ad) => `${ad} grubundan ayrılmak istiyor musun? Geri dönmek için birinin seni yeniden eklemesi gerekir.`,
  cikar: 'Çıkar',
  kurucu: 'Kurucu',
  uyeler: (n) => `ÜYELER — ${n}`,
  genelHata: 'Bir şeyler ters gitti. İnternetini kontrol edip tekrar dene.',
}

// Küçük harf/avatar (rozetin bir yarısı)
function rozetParcasi(kisi) {
  let av
  if (kisi?.avatar_url) {
    av = document.createElement('img')
    av.src = kisi.avatar_url
    av.alt = ''
  } else {
    av = document.createElement('span')
    av.textContent = (Array.from(kisi?.username ?? '')[0] ?? '?').toLocaleUpperCase('tr')
  }
  av.className = 'group-badge-part'
  av.style.background = kisi?.color ?? null
  av.style.color = avatarTextColor(kisi?.color)
  return av
}

// Grup rozeti: ilk iki üyenin (kendin hariç) baş harfleri üst üste biner. Süs: ekran okuyucudan gizli
// (grubun adı hemen yanında yazar).
export function grupRozeti(thread, selfId, sinif = '') {
  const kutu = document.createElement('span')
  kutu.className = 'group-badge' + (sinif ? ' ' + sinif : '')
  kutu.setAttribute('aria-hidden', 'true')
  for (const u of rozetUyeleri(thread, selfId)) kutu.appendChild(rozetParcasi(u))
  return kutu
}

// Onay kutulu kişi listesi (çoklu seçim). Dönen: { el, secili() -> id[] }
function kisiSecici(kisiler, { enFazla, onDegisti }) {
  const el = document.createElement('fieldset')
  el.className = 'group-picker'
  const lejant = document.createElement('legend')
  lejant.textContent = GRUP_METINLERI.secin
  el.appendChild(lejant)
  const kutular = []
  for (const k of kisiler) {
    const satir = document.createElement('label')
    satir.className = 'group-picker-row'
    const kutu = document.createElement('input')
    kutu.type = 'checkbox'
    kutu.value = k.id
    kutu.onchange = () => {
      // Sınır dolunca seçilmeyenler kapanır (klavyeyle de seçilemez)
      const n = kutular.filter((x) => x.checked).length
      for (const x of kutular) x.disabled = !x.checked && n >= enFazla
      onDegisti?.(n)
    }
    kutular.push(kutu)
    const ad = document.createElement('span')
    ad.className = 'group-picker-name'
    ad.textContent = k.username
    satir.append(kutu, avatarWithDot(k, 'offline', 'group-picker-avatar'), ad)
    el.appendChild(satir)
  }
  return { el, secili: () => kutular.filter((x) => x.checked).map((x) => x.value) }
}

function bilgiYazisi(metin) {
  const p = document.createElement('p')
  p.className = 'group-hint'
  p.textContent = metin
  return p
}

function adKutusu(deger = '') {
  const input = document.createElement('input')
  input.type = 'text'
  input.maxLength = GRUP_ADI_MAX
  input.value = deger
  input.autocomplete = 'off'
  return input
}

// "Grup oluştur": arkadaşlardan 2–9 kişi + isteğe bağlı ad. onCreate(ids, ad) -> Promise; hata olursa
// pencere açık kalır, metni yazar.
export function openCreateGroupDialog({ friends = [], onCreate }) {
  const ad = adKutusu()
  const alan = formAlani(GRUP_METINLERI.adEtiket, ad)
  const sayac = document.createElement('p')
  sayac.className = 'group-count'
  sayac.setAttribute('aria-live', 'polite')
  const say = (n) => { sayac.textContent = `${n + 1}/${GRUP_EN_FAZLA} kişi (sen dahil)` }
  say(0)
  const govde = [alan.etiket, alan.input, alan.hata]
  let secici = null
  if (friends.length < GRUP_EN_AZ - 1) govde.push(bilgiYazisi(GRUP_METINLERI.arkadasYok))
  else {
    secici = kisiSecici(friends, { enFazla: GRUP_EN_FAZLA - 1, onDegisti: say })
    govde.push(sayac, secici.el)
  }
  return createModalShell({
    baslik: GRUP_METINLERI.olusturBaslik,
    govde,
    birincil: secici
      ? {
          yazi: GRUP_METINLERI.olustur,
          tik: async () => {
            const ids = secici.secili()
            if (ids.length < GRUP_EN_AZ - 1) return GRUP_METINLERI.enAz
            if (ids.length > GRUP_EN_FAZLA - 1) return GRUP_METINLERI.enFazla
            try { await onCreate?.(ids, ad.value) } catch (e) { return e?.message || GRUP_METINLERI.genelHata }
            return null
          },
        }
      : null,
  })
}

// "Üye ekle": gruptaki olmayan arkadaşlardan biri. onAdd(id) -> Promise.
export function openAddMemberDialog({ candidates = [], onAdd }) {
  const govde = []
  let secim = null
  if (!candidates.length) govde.push(bilgiYazisi(GRUP_METINLERI.eklenecekYok))
  else {
    secim = kisiSecici(candidates, { enFazla: candidates.length })
    govde.push(secim.el)
  }
  return createModalShell({
    baslik: GRUP_METINLERI.uyeEkle,
    govde,
    birincil: secim
      ? {
          yazi: GRUP_METINLERI.ekle,
          tik: async () => {
            const ids = secim.secili()
            if (!ids.length) return GRUP_METINLERI.secin
            // Sırayla eklenir; biri olmazsa (gizli kod) kalanlar denenmez, metin pencerede yazar
            for (const id of ids) {
              try { await onAdd?.(id) } catch (e) { return e?.message || GRUP_METINLERI.genelHata }
            }
            return null
          },
        }
      : null,
  })
}

// "Grubun adını değiştir": boş ad, adı kaldırır. onRename(ad) -> Promise.
export function openRenameGroupDialog({ current = '', onRename }) {
  const ad = adKutusu(current ?? '')
  const alan = formAlani(GRUP_METINLERI.adEtiket, ad)
  return createModalShell({
    baslik: GRUP_METINLERI.adDegistir,
    govde: [alan.etiket, alan.input, alan.hata, bilgiYazisi(GRUP_METINLERI.adIpucu)],
    enterIleKaydet: true,
    birincil: {
      yazi: GRUP_METINLERI.adKaydet,
      tik: async () => {
        try { await onRename?.(ad.value) } catch (e) { return { alan: ad, metin: e?.message || GRUP_METINLERI.genelHata } }
        return null
      },
    },
  })
}

// "Gruptan ayrıl" onayı (kırmızı düğme). onLeave() -> Promise.
export function confirmLeaveGroup({ ad, onLeave }) {
  const p = document.createElement('p')
  p.className = 'confirm-text'
  p.textContent = GRUP_METINLERI.ayrilOnay(ad)
  return createModalShell({
    baslik: GRUP_METINLERI.ayril,
    govde: [p],
    tehlikeli: true,
    birincil: {
      yazi: GRUP_METINLERI.ayril,
      tik: async () => {
        try { await onLeave?.() } catch (e) { return e?.message || GRUP_METINLERI.genelHata }
        return null
      },
    },
  })
}

function panelDugmesi(yazi, sinif, onClick) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'group-action ' + sinif
  b.textContent = yazi
  b.dataset.odak = `grup-${sinif}`
  b.onclick = () => onClick?.()
  return b
}

// Grup açıkken sağ panel: üye listesi (kurucu işaretli; kurucuya her üyede "Çıkar") ve grup işleri.
// thread: grup konuşması, selfId, presence: Map. handlers: { onAdd, onRemove(kisi), onRename, onToggleMute, onLeave }
export function renderGroupPanel(panel, { thread, selfId, presence = new Map(), handlers = {} }) {
  panel.classList.add('member-panel')
  const kok = document.createElement('div')
  kok.className = 'group-panel'
  const baslik = document.createElement('div')
  baslik.className = 'group-panel-title'
  baslik.append(grupRozeti(thread, selfId, 'group-badge-large'))
  const ad = document.createElement('span')
  ad.textContent = grupAdi(thread, selfId)
  baslik.appendChild(ad)

  const bolum = document.createElement('div')
  bolum.className = 'member-section-title'
  bolum.textContent = GRUP_METINLERI.uyeler(thread.members?.length ?? 0)
  const liste = document.createElement('ul')
  liste.className = 'group-members'
  liste.setAttribute('aria-label', 'Grup üyeleri')
  const kurucuyum = thread.ownerId === selfId
  for (const u of thread.members ?? []) {
    const li = document.createElement('li')
    li.className = 'member group-member'
    const av = avatarWithDot(u, u.id === selfId ? 'online' : (presence?.get?.(u.id)?.status ?? 'offline'))
    makeProfileOpener(av, u, `grup-uye-${u.id}`)
    const isim = document.createElement('span')
    isim.className = 'member-name'
    isim.textContent = u.username
    li.append(av, isim)
    if (u.id === thread.ownerId) {
      const k = document.createElement('span')
      k.className = 'group-owner'
      k.textContent = '👑'
      k.title = GRUP_METINLERI.kurucu
      k.setAttribute('aria-label', GRUP_METINLERI.kurucu)
      k.setAttribute('role', 'img')
      li.appendChild(k)
    }
    if (kurucuyum && u.id !== selfId) {
      const cik = document.createElement('button')
      cik.type = 'button'
      cik.className = 'group-remove secondary'
      cik.textContent = GRUP_METINLERI.cikar
      cik.setAttribute('aria-label', `${u.username} kişisini gruptan çıkar`)
      cik.onclick = () => handlers.onRemove?.(u)
      li.appendChild(cik)
    }
    liste.appendChild(li)
  }

  const isler = document.createElement('div')
  isler.className = 'group-actions'
  const dolu = (thread.members?.length ?? 0) >= GRUP_EN_FAZLA
  const ekle = panelDugmesi(GRUP_METINLERI.uyeEkle, 'ekle', handlers.onAdd)
  if (dolu) {
    ekle.disabled = true
    ekle.title = GRUP_METINLERI.enFazla
  }
  isler.append(
    ekle,
    panelDugmesi(GRUP_METINLERI.adDegistir, 'ad', handlers.onRename),
    panelDugmesi(thread.muted ? GRUP_METINLERI.sesiAc : GRUP_METINLERI.sessizeAl, 'sessiz', handlers.onToggleMute),
    panelDugmesi(GRUP_METINLERI.ayril, 'ayril danger', handlers.onLeave),
  )
  kok.append(baslik, bolum, liste, isler)
  panel.replaceChildren(kok)
}
