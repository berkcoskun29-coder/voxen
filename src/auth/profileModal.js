// Profil penceresi ve "Profilini tamamla" formu.
import { AVATAR_COLORS, KULLANICI_ALINMIS, createProfile, rastgeleRenk, updateProfile, uploadAvatar, validateUsername } from './auth.js'
import { getLocalPresencePrefs, setLocalPresencePrefs } from './profilePrefs.js'
import { createModalShell } from '../ui/modal.js'
import { avatarTextColor } from '../ui/avatarColor.js'

// Renklerin ekran okuyucuda okunan adları (listede olmayan renk "Renk 3" gibi sırasıyla okunur)
const RENK_ADLARI = {
  '#5b7cfa': 'Mavi', '#3be37a': 'Yeşil', '#f5a524': 'Turuncu', '#ef5b9c': 'Pembe',
  '#2ec4d6': 'Turkuaz', '#a98bff': 'Mor', '#ff7a59': 'Mercan', '#9bd13d': 'Açık yeşil',
}

// "Renk" başlıklarının id'leri benzersiz olsun (aria-labelledby için)
let renkGrupSayac = 0

// Renk düğmelerini ve seçim mantığını kurar; seçili rengi döndüren bir fonksiyon verir.
// kutu: .swatches kutusu; hemen önündeki .group-label ("Renk") grubun etiketi olur.
// onDegisim(renk): renk seçilince çağrılır (profil penceresi önizlemeyi günceller).
function renkSecici(kutu, baslangic, onDegisim) {
  let secili = baslangic
  // Grup etiketi: "Renk" yazısı tek bir alana değil, düğme grubuna aittir
  const baslik = kutu.previousElementSibling
  if (baslik?.classList.contains('group-label')) {
    baslik.id = `renk-baslik-${++renkGrupSayac}`
    kutu.setAttribute('role', 'group')
    kutu.setAttribute('aria-labelledby', baslik.id)
  }
  kutu.replaceChildren()
  AVATAR_COLORS.forEach((c, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'swatch'
    b.dataset.color = c
    b.style.background = c
    b.setAttribute('aria-label', RENK_ADLARI[c] ?? `Renk ${i + 1}`)
    kutu.appendChild(b)
  })
  function isaretle() {
    kutu.querySelectorAll('.swatch').forEach((b) => {
      const bu = b.dataset.color === secili
      b.classList.toggle('selected', bu) // seçili renk iki halkayla görünür (CSS: .swatch.selected)
      b.setAttribute('aria-pressed', String(bu)) // ekran okuyucu da hangisinin seçili olduğunu bilsin
    })
  }
  kutu.querySelectorAll('.swatch').forEach((b) => {
    b.onclick = () => { secili = b.dataset.color; isaretle(); onDegisim?.(secili) }
  })
  isaretle()
  return () => secili
}

// Profil düzenleme penceresi (ortak pencere kalıbı). onSaved(yeniProfil) kaydedilince çağrılır.
// Üstte 72px avatar önizlemesi: renk seçilince ya da resim seçilince kaydetmeden önce görünür.
export function openProfileModal(profile, onSaved) {
  const prefs = getLocalPresencePrefs()
  // Gövde: sabit HTML (içinde kullanıcı metni yok; değerler aşağıda .value ile yazılır)
  const govde = document.createElement('div')
  govde.innerHTML = `
    <div class="profile-photo">
      <span class="profile-preview" aria-hidden="true"></span>
      <div>
        <button type="button" class="secondary" data-act="resim">Resim değiştir</button>
        <p class="hint" data-yer="resim-notu">En fazla 1 MB</p>
      </div>
      <input type="file" name="avatar" accept="image/*" hidden />
    </div>
    <label for="profil-ad">Kullanıcı adı</label>
    <input type="text" id="profil-ad" name="username" maxlength="20" />
    <span class="group-label">Renk</span>
    <div class="swatches"></div>
    <div class="check-row"><input type="checkbox" name="dnd" id="dnd" /><label for="dnd">Rahatsız etmeyin</label></div>
    <label for="profil-durum">Durum yazısı</label>
    <input type="text" id="profil-durum" name="status" maxlength="60" />`

  const q = (s) => govde.querySelector(s)
  const onizleme = q('.profile-preview')
  const dosyaKutusu = q('[name=avatar]')
  const adKutusu = q('[name=username]')
  adKutusu.value = profile.username
  q('[name=dnd]').checked = prefs.dnd
  q('[name=status]').value = prefs.statusText

  let resimAdresi = profile.avatar_url ?? null // önizlemede gösterilecek resim (yoksa baş harf)
  let geciciAdres = null // seçilen dosya için tarayıcının verdiği geçici adres (kapanınca bırakılır)

  // Önizlemeyi yeniden çiz: arka plan seçili renk; resim varsa resim, yoksa adın baş harfi
  function onizlemeyiCiz() {
    onizleme.style.background = seciliRenk()
    onizleme.style.color = avatarTextColor(seciliRenk())
    onizleme.replaceChildren()
    if (resimAdresi) {
      const img = document.createElement('img')
      img.src = resimAdresi
      img.alt = ''
      onizleme.appendChild(img)
    } else {
      onizleme.textContent = (Array.from(adKutusu.value.trim())[0] ?? '?').toLocaleUpperCase('tr')
    }
  }
  const seciliRenk = renkSecici(q('.swatches'), profile.color, onizlemeyiCiz)
  adKutusu.addEventListener('input', () => { if (!resimAdresi) onizlemeyiCiz() })

  // Tarayıcının beyaz "Dosya Seç" kutusu gizli; düğme onu açar
  q('[data-act=resim]').onclick = () => dosyaKutusu.click()
  dosyaKutusu.onchange = () => {
    const dosya = dosyaKutusu.files[0]
    if (!dosya) return
    q('[data-yer=resim-notu]').textContent = dosya.name // dosya adı metin olarak yazılır
    if (typeof URL.createObjectURL === 'function') {
      if (geciciAdres) URL.revokeObjectURL(geciciAdres)
      geciciAdres = URL.createObjectURL(dosya)
      resimAdresi = geciciAdres
    }
    onizlemeyiCiz()
  }

  createModalShell({
    baslik: 'Profil',
    govde: [govde],
    birincil: {
      yazi: 'Kaydet',
      // Hata metni dönerse pencere açık kalır ve metin gösterilir; null dönerse kapanır
      tik: async () => {
        const ad = adKutusu.value.trim()
        const adHatasi = validateUsername(ad)
        if (adHatasi) return adHatasi

        const sonuc = await updateProfile(profile.id, { username: ad, color: seciliRenk() })
        if (sonuc.error) return sonuc.error
        const yeni = { ...profile, username: ad, color: seciliRenk() }

        // Durum yazısı ve rahatsız etmeyin: şimdilik yerelde saklanır
        setLocalPresencePrefs({ dnd: q('[name=dnd]').checked, statusText: q('[name=status]').value })

        const dosya = dosyaKutusu.files[0]
        if (dosya) {
          try { yeni.avatar_url = await uploadAvatar(dosya) } catch (e) { return e.message }
        }
        onSaved?.(yeni)
        return null
      },
    },
    onKapat: () => { if (geciciAdres) URL.revokeObjectURL(geciciAdres) },
  })
  onizlemeyiCiz()
}

// Oturum açık ama profili olmayan kullanıcı için tam ekran form.
// Giriş kartıyla aynı kabuk (logo + başlık, tek satır açıklama, tam genişlik düğme) ve profil
// penceresindeki gibi 72px canlı önizleme: ad yazıldıkça baş harf, renk seçildikçe renk değişir.
// mesaj: ekranda baştan gösterilecek hata (örn. kullanıcı adı alınmış → kutunun altında).
export function renderCompleteProfile(container, userId, onDone, mesaj = '') {
  // Sabit HTML (kullanıcı metni yok; ad önizlemesi aşağıda textContent ile yazılır)
  container.innerHTML = `
    <div class="card">
      <h1 class="brand"><img src="/favicon.svg" alt="" width="32" height="32" />Profilini tamamla</h1>
      <p class="tagline">Arkadaşların seni bu isim ve renkle görecek.</p>
      <form novalidate>
        <div class="profile-photo">
          <span class="profile-preview" aria-hidden="true"></span>
          <div>
            <div class="preview-name"></div>
            <p class="hint">Resmi sonra Profil'den ekleyebilirsin</p>
          </div>
        </div>
        <label for="tamamla-ad">Kullanıcı adı</label>
        <input type="text" id="tamamla-ad" name="username" maxlength="20" autocomplete="username" aria-describedby="hata-tamamla-ad" />
        <p class="field-error" id="hata-tamamla-ad"></p>
        <span class="group-label">Renk</span>
        <div class="swatches"></div>
        <p class="error" role="alert"></p>
        <button type="submit" class="block">Devam</button>
      </form>
    </div>`
  const q = (s) => container.querySelector(s)
  const form = q('form')
  const adKutusu = q('[name=username]')
  const adHatasiSatiri = q('#hata-tamamla-ad')
  const genelHata = q('.error')
  const onizleme = q('.profile-preview')
  const adOnizleme = q('.preview-name')

  // Önizleme: seçili renk zemin, adın baş harfi (ad yoksa "?"); yanında yazılan ad
  function onizlemeyiCiz() {
    const ad = adKutusu.value.trim()
    onizleme.style.background = seciliRenk()
    onizleme.style.color = avatarTextColor(seciliRenk())
    onizleme.textContent = (Array.from(ad)[0] ?? '?').toLocaleUpperCase('tr')
    adOnizleme.textContent = ad
  }
  const seciliRenk = renkSecici(q('.swatches'), rastgeleRenk(), onizlemeyiCiz)

  // Kutunun altındaki hata: kırmızı kenar (aria-invalid) + metin; boş metin temizler
  function adHatasi(metin) {
    adHatasiSatiri.textContent = metin
    if (metin) adKutusu.setAttribute('aria-invalid', 'true')
    else adKutusu.removeAttribute('aria-invalid')
  }
  adKutusu.addEventListener('input', () => { adHatasi(''); onizlemeyiCiz() })

  // Başlangıç mesajı: kullanıcı adıyla ilgiliyse kutunun altına, değilse genel satıra
  if (mesaj === KULLANICI_ALINMIS) adHatasi(mesaj)
  else genelHata.textContent = mesaj

  form.onsubmit = async (e) => {
    e.preventDefault()
    adHatasi('')
    genelHata.textContent = ''
    const ad = adKutusu.value
    const hata = validateUsername(ad)
    if (hata) { adHatasi(hata); adKutusu.focus(); return }
    const dugme = form.querySelector('button[type=submit]')
    dugme.disabled = true
    const sonuc = await createProfile(userId, ad, seciliRenk())
    dugme.disabled = false
    if (!sonuc.error) return onDone()
    if (sonuc.alan === 'username') { adHatasi(sonuc.error); adKutusu.focus() }
    else genelHata.textContent = sonuc.error
  }

  onizlemeyiCiz()
  adKutusu.focus()
}
