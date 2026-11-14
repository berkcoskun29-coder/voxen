// Sunucu ayarları > Roller sekmesi (v0.11.0).
//
//   ┌──────────────────┬──────────────────────────────┐
//   │ [Rol oluştur]    │ Rol adı  [ Mod          ]    │
//   │ ● Yönetici  ↑ ↓  │ Renk     ○ ● ● ● ● ● ● ● ●   │
//   │ ● Mod       ↑ ↓  │ ☐ Üyeleri ayrı göster        │
//   │   @herkes        │ İzinler                      │
//   │                  │ ☑ Kanalları yönet  (açıklama)│
//   │                  │ [Kaydet]        [Rolü sil]   │
//   └──────────────────┴──────────────────────────────┘
//
// Liste en yüksek rol üstte, @herkes en altta. Sıralama ↑↓ düğmeleriyle ya da sürükle-bırakla.
// Yetkinin yetmediği roller (senin en yüksek rolün ve üstü) soluk ve düzenlenemez.
// Bu dosya yalnız arayüzü kurar; veri işleri (RPC, yeniden yükleme) çağıranın işlemler nesnesindedir.
// Kullanıcı yazıları (rol adları) textContent ile basılır.
import {
  IZINLER, ROL_RENKLERI, ROL_ADI_EN_UZUN, rolRengiCss, siraliRoller, rolDuzenlenebilir, rolSilinebilir, rolTasinabilir,
  izinDegistirilebilir, rolOlusturulabilir,
} from '../data/rolKurallari.js'
import { createModalShell } from './modal.js'

const YETKI_YETMEZ = 'Bu rol senin en yüksek rolünden aşağıda değil.'

function el(etiket, sinif = '', yazi = null) {
  const e = document.createElement(etiket)
  if (sinif) e.className = sinif
  if (yazi != null) e.textContent = yazi
  return e
}

// Renk noktası (renksizse içi boş halka)
export function rolNoktasi(rol) {
  const n = el('span', 'role-dot')
  n.setAttribute('aria-hidden', 'true')
  const css = rolRengiCss(rol?.color)
  if (css) n.style.background = css
  else n.classList.add('renksiz')
  return n
}

// Rol silme onayı
export function deleteRoleDialog(rol, sil) {
  const p = el('p', 'confirm-text', `"${rol.name}" rolü silinsin mi? Bu role sahip herkesten kalkar. Bu geri alınamaz.`)
  return createModalShell({ baslik: 'Rolü sil', govde: [p], birincil: { yazi: 'Sil', tik: sil }, tehlikeli: true })
}

// getDurum(): { roles, yetki } güncel durum (her çizimde yeniden okunur)
// islemler: { olustur() -> Promise<yeniRolId>, kaydet(rol, { name, color, permissions, hoist }), sil(rol), tasi(rol, hedef) }
//   Hepsi Promise; hata fırlatırsa metni panelin hata satırına yazılır.
// Dönen: { el, yenile(), kapat() }. yenile(): rol listesi değişti (canlı olay); düzenlenmekte olan rol
//   kaydedilmemiş değişiklik taşıyorsa düzenleyici yerinde kalır.
export function mountRolesPanel({ getDurum, islemler }) {
  const kok = el('div', 'roles-panel')
  const solKolon = el('div', 'roles-list-col')
  const olusturDugmesi = el('button', 'secondary small roles-create', 'Rol oluştur')
  olusturDugmesi.type = 'button'
  olusturDugmesi.dataset.odak = 'rol-olustur'
  const liste = el('ul', 'roles-list')
  liste.setAttribute('aria-label', 'Roller')
  solKolon.append(olusturDugmesi, liste)
  const duzenleyici = el('div', 'role-editor')
  const hata = el('p', 'error roles-error')
  hata.setAttribute('role', 'alert')
  kok.append(solKolon, duzenleyici, hata)

  let seciliId = null
  let kirli = false // düzenleyicide kaydedilmemiş değişiklik var mı
  let calisiyor = false
  let kapandi = false
  let surukleneId = null
  let bekleyenId = null // yeni oluşturulan rol: liste yüklenince seçilir

  const durum = () => getDurum() ?? { roles: [], yetki: null }
  const bul = (id) => durum().roles.find((r) => r.id === id) ?? null

  async function yap(is) {
    if (calisiyor || kapandi) return
    calisiyor = true
    hata.textContent = ''
    try { return await is() } catch (e) {
      if (!kapandi) hata.textContent = e?.message || 'İşlem yapılamadı. İnternetini kontrol edip tekrar dene.'
      return undefined
    } finally { calisiyor = false }
  }

  olusturDugmesi.onclick = async () => {
    const id = await yap(() => islemler.olustur())
    if (!id) return
    bekleyenId = id
    if (bul(id)) ciz() // liste zaten yüklendiyse hemen seç; değilse yenile() seçer
  }

  function odakAnahtari() {
    const a = document.activeElement
    return kok.contains(a) ? a.dataset?.odak : null
  }
  function odakla(anahtar) {
    if (!anahtar) return
    ;[...kok.querySelectorAll('[data-odak]')].find((e) => e.dataset.odak === anahtar)?.focus()
  }

  function listeyiCiz() {
    const { roles, yetki } = durum()
    const anahtar = odakAnahtari()
    olusturDugmesi.hidden = !rolOlusturulabilir(yetki) // v11 K3: rolsüz (yalnız @herkes) yönetici oluşturamaz
    liste.replaceChildren()
    const sirali = siraliRoller(roles)
    const enUst = sirali.filter((r) => !r.is_default).length
    for (const rol of sirali) {
      const satir = el('li', 'role-row')
      satir.dataset.rolId = rol.id
      const duzenlenir = rolDuzenlenebilir(yetki, rol)
      if (!duzenlenir) satir.classList.add('kilitli')
      if (rol.id === seciliId) satir.classList.add('secili')
      const sec = el('button', 'role-select')
      sec.type = 'button'
      sec.dataset.odak = `rol-${rol.id}`
      sec.setAttribute('aria-current', String(rol.id === seciliId))
      sec.append(rolNoktasi(rol), el('span', 'role-name', rol.name))
      if (!duzenlenir && !rol.is_default) sec.title = YETKI_YETMEZ
      sec.onclick = () => {
        if (rol.id === seciliId) return
        seciliId = rol.id
        kirli = false
        ciz()
        duzenleyici.querySelector('input, button')?.focus()
      }
      satir.appendChild(sec)
      if (!rol.is_default) {
        const yukari = el('button', 'icon-btn role-up', '↑')
        yukari.type = 'button'
        yukari.dataset.odak = `rol-yukari-${rol.id}`
        yukari.setAttribute('aria-label', `${rol.name} rolünü yukarı taşı`)
        yukari.disabled = rol.position >= enUst || !rolTasinabilir(yetki, rol, rol.position + 1)
        yukari.onclick = () => yap(() => islemler.tasi(rol, rol.position + 1))
        const asagi = el('button', 'icon-btn role-down', '↓')
        asagi.type = 'button'
        asagi.dataset.odak = `rol-asagi-${rol.id}`
        asagi.setAttribute('aria-label', `${rol.name} rolünü aşağı taşı`)
        asagi.disabled = rol.position <= 1 || !rolTasinabilir(yetki, rol, rol.position - 1)
        asagi.onclick = () => yap(() => islemler.tasi(rol, rol.position - 1))
        satir.append(yukari, asagi)
        // Sürükle-bırak: taşınabilen rol, taşınabildiği bir rolün yerine bırakılır
        if (rolSilinebilir(yetki, rol)) {
          satir.draggable = true
          satir.addEventListener('dragstart', (e) => {
            surukleneId = rol.id
            e.dataTransfer?.setData('text/plain', rol.id)
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
            satir.classList.add('surukleniyor')
          })
          satir.addEventListener('dragend', () => {
            surukleneId = null
            satir.classList.remove('surukleniyor')
            liste.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'))
          })
        }
        satir.addEventListener('dragover', (e) => {
          const surukle = bul(surukleneId)
          if (!surukle || surukle.id === rol.id || !rolTasinabilir(yetki, surukle, rol.position)) return
          e.preventDefault()
          satir.classList.add('drag-over')
        })
        satir.addEventListener('dragleave', () => satir.classList.remove('drag-over'))
        satir.addEventListener('drop', (e) => {
          e.preventDefault()
          satir.classList.remove('drag-over')
          const surukle = bul(surukleneId ?? e.dataTransfer?.getData('text/plain'))
          surukleneId = null
          if (!surukle || surukle.id === rol.id || !rolTasinabilir(yetki, surukle, rol.position)) return
          yap(() => islemler.tasi(surukle, rol.position))
        })
      }
      liste.appendChild(satir)
    }
    odakla(anahtar)
  }

  // Renk seçimi: radiogroup (ok tuşlarıyla gezilir, yalnız seçili olan Tab durağı)
  function renkSecici(secili, pasif, degisti) {
    const grup = el('div', 'role-colors')
    grup.setAttribute('role', 'radiogroup')
    grup.setAttribute('aria-label', 'Rol rengi')
    const secenekler = [{ ad: null, baslik: 'Renksiz' }, ...ROL_RENKLERI]
    let deger = secili ?? null
    const dugmeler = secenekler.map((s) => {
      const b = el('button', 'role-color')
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-label', s.baslik)
      b.title = s.baslik
      const css = rolRengiCss(s.ad)
      if (css) b.style.background = css
      else b.classList.add('renksiz')
      b.disabled = pasif
      b.onclick = () => isaretle(s.ad, true)
      grup.appendChild(b)
      return b
    })
    function isaretle(ad, kullanici = false) {
      deger = ad
      secenekler.forEach((s, i) => {
        const on = s.ad === ad
        dugmeler[i].setAttribute('aria-checked', String(on))
        dugmeler[i].tabIndex = on ? 0 : -1
      })
      if (kullanici) degisti()
    }
    grup.addEventListener('keydown', (e) => {
      const i = dugmeler.indexOf(document.activeElement)
      if (i < 0 || pasif) return
      let j
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % dugmeler.length
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + dugmeler.length) % dugmeler.length
      else return
      e.preventDefault()
      isaretle(secenekler[j].ad, true)
      dugmeler[j].focus()
    })
    isaretle(deger)
    return { grup, deger: () => deger }
  }

  function duzenleyiciyiCiz() {
    const { yetki } = durum()
    const rol = bul(seciliId)
    duzenleyici.replaceChildren()
    if (!rol) {
      duzenleyici.appendChild(el('p', 'muted-note', 'Düzenlemek için soldan bir rol seç.'))
      return
    }
    const duzenlenir = rolDuzenlenebilir(yetki, rol)
    const baslik = el('h3', 'settings-section-title', rol.is_default ? '@herkes (herkesin rolü)' : `Rolü düzenle: ${rol.name}`)
    duzenleyici.appendChild(baslik)
    if (!duzenlenir) duzenleyici.appendChild(el('p', 'muted-note', yetki?.has('MANAGE_ROLES') ? YETKI_YETMEZ : 'Rolleri düzenlemeye yetkin yok.'))
    if (rol.is_default) duzenleyici.appendChild(el('p', 'muted-note', 'Sunucudaki herkes bu role sahiptir. Yalnız izinleri değiştirilebilir.'))
    const kirlet = () => { kirli = true }

    let adKutusu = null
    let renk = null
    let ayri = null
    if (!rol.is_default) {
      adKutusu = el('input')
      adKutusu.type = 'text'
      adKutusu.id = `rol-adi-${rol.id}`
      adKutusu.maxLength = ROL_ADI_EN_UZUN
      adKutusu.value = rol.name
      adKutusu.disabled = !duzenlenir
      adKutusu.addEventListener('input', kirlet)
      const etiket = el('label', '', 'Rol adı')
      etiket.htmlFor = adKutusu.id
      const renkEtiket = el('span', 'group-label', 'Renk')
      renk = renkSecici(rol.color, !duzenlenir, kirlet)
      const ayriEtiket = el('label', 'role-check')
      ayri = el('input')
      ayri.type = 'checkbox'
      ayri.checked = !!rol.hoist
      ayri.disabled = !duzenlenir
      ayri.addEventListener('change', kirlet)
      ayriEtiket.append(ayri, ' Üyeleri ayrı göster (üye listesinde kendi başlığıyla)')
      duzenleyici.append(etiket, adKutusu, renkEtiket, renk.grup, ayriEtiket)
    }

    const izinKutusu = el('fieldset', 'role-perms')
    izinKutusu.appendChild(el('legend', 'group-label', 'İzinler'))
    const kutular = IZINLER.map((izin) => {
      const satir = el('label', 'role-perm')
      const k = el('input')
      k.type = 'checkbox'
      k.value = izin.ad
      k.checked = (rol.permissions ?? []).includes(izin.ad)
      k.disabled = !duzenlenir || !izinDegistirilebilir(yetki, izin.ad)
      k.addEventListener('change', kirlet)
      const metin = el('span', 'role-perm-text')
      metin.append(el('strong', 'role-perm-name', izin.baslik), el('span', 'role-perm-desc', izin.aciklama))
      if (duzenlenir && k.disabled) metin.appendChild(el('span', 'role-perm-desc', 'Bu izin sende olmadığı için değiştiremezsin.'))
      satir.append(k, metin)
      izinKutusu.appendChild(satir)
      return k
    })
    duzenleyici.appendChild(izinKutusu)

    if (duzenlenir) {
      const altSira = el('div', 'role-actions')
      const kaydet = el('button', 'role-save', 'Kaydet')
      kaydet.type = 'button'
      kaydet.onclick = async () => {
        const ad = adKutusu ? adKutusu.value.trim() : rol.name
        if (adKutusu && (ad.length < 1 || ad.length > ROL_ADI_EN_UZUN)) {
          hata.textContent = 'Rol adı boş olamaz. Bir ad yaz (en fazla 30 karakter).'
          adKutusu.focus()
          return
        }
        const degerler = {
          name: ad,
          color: renk ? renk.deger() : rol.color,
          permissions: kutular.filter((k) => k.checked).map((k) => k.value),
          hoist: ayri ? ayri.checked : rol.hoist,
        }
        const sonuc = await yap(async () => { await islemler.kaydet(rol, degerler); return true })
        if (sonuc) { kirli = false; ciz() }
      }
      altSira.appendChild(kaydet)
      if (rolSilinebilir(yetki, rol)) {
        const sil = el('button', 'danger role-delete', 'Rolü sil')
        sil.type = 'button'
        sil.onclick = () => {
          deleteRoleDialog(rol, async () => {
            try { await islemler.sil(rol) } catch (e) { return e?.message || 'Silinemedi.' }
            if (seciliId === rol.id) { seciliId = null; kirli = false }
            ciz()
            return null
          })
        }
        altSira.appendChild(sil)
      }
      duzenleyici.appendChild(altSira)
    }
  }

  function ciz() {
    if (kapandi) return
    if (bekleyenId && bul(bekleyenId)) { seciliId = bekleyenId; bekleyenId = null; kirli = false }
    if (seciliId && !bul(seciliId)) { seciliId = null; kirli = false } // rol silindi
    listeyiCiz()
    duzenleyiciyiCiz()
  }

  // İlk seçim: düzenlenebilen en yüksek rol, yoksa @herkes
  {
    const { roles, yetki } = durum()
    const sirali = siraliRoller(roles)
    seciliId = (sirali.find((r) => !r.is_default && rolDuzenlenebilir(yetki, r)) ?? sirali.find((r) => r.is_default) ?? sirali[0])?.id ?? null
  }
  ciz()

  return {
    el: kok,
    yenile() {
      if (kapandi) return
      if (kirli && bul(seciliId) && !(bekleyenId && bul(bekleyenId))) { listeyiCiz(); return } // yazılanlar kaybolmasın
      ciz()
    },
    kapat() { kapandi = true },
  }
}
