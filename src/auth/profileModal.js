// Profil penceresi ve "Profilini tamamla" formu.
import { AVATAR_COLORS, createProfile, rastgeleRenk, updateProfile, uploadAvatar, validateUsername } from './auth.js'
import { getLocalPresencePrefs, setLocalPresencePrefs } from './profilePrefs.js'

// Renk düğmelerini ve seçim mantığını kurar; seçili rengi döndüren bir fonksiyon verir.
function renkSecici(kutu, baslangic) {
  let secili = baslangic
  kutu.innerHTML = AVATAR_COLORS.map(
    (c) => `<button type="button" class="swatch" data-color="${c}" style="background:${c}"></button>`,
  ).join('')
  function isaretle() {
    kutu.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('selected', b.dataset.color === secili))
  }
  kutu.querySelectorAll('.swatch').forEach((b) => {
    b.onclick = () => { secili = b.dataset.color; isaretle() }
  })
  isaretle()
  return () => secili
}

// Profil düzenleme penceresi. onSaved(yeniProfil) kaydedilince çağrılır.
export function openProfileModal(profile, onSaved) {
  const prefs = getLocalPresencePrefs()
  const arka = document.createElement('div')
  arka.className = 'modal-back'
  arka.innerHTML = `
    <div class="card">
      <h1>Profil</h1>
      <img class="avatar" alt="" hidden />
      <label>Resim (en fazla 1 MB)</label>
      <input type="file" name="avatar" accept="image/*" />
      <label>Kullanıcı adı</label>
      <input type="text" name="username" maxlength="20" />
      <label>Renk</label>
      <div class="swatches"></div>
      <div class="row"><input type="checkbox" name="dnd" id="dnd" /><label for="dnd">Rahatsız etmeyin</label></div>
      <label>Durum yazısı</label>
      <input type="text" name="status" maxlength="60" />
      <p class="error"></p>
      <div class="buttons">
        <button type="button" class="secondary" data-act="iptal">Vazgeç</button>
        <button type="button" data-act="kaydet">Kaydet</button>
      </div>
    </div>`
  document.body.appendChild(arka)

  const q = (s) => arka.querySelector(s)
  if (profile.avatar_url) {
    q('.avatar').src = profile.avatar_url
    q('.avatar').hidden = false
  }
  q('[name=username]').value = profile.username
  q('[name=dnd]').checked = prefs.dnd
  q('[name=status]').value = prefs.statusText
  const seciliRenk = renkSecici(q('.swatches'), profile.color)
  const hata = q('.error')

  q('[data-act=iptal]').onclick = () => arka.remove()
  q('[data-act=kaydet]').onclick = async () => {
    hata.textContent = ''
    const ad = q('[name=username]').value.trim()
    const adHatasi = validateUsername(ad)
    if (adHatasi) { hata.textContent = adHatasi; return }

    const sonuc = await updateProfile(profile.id, { username: ad, color: seciliRenk() })
    if (sonuc.error) { hata.textContent = sonuc.error; return }
    const yeni = { ...profile, username: ad, color: seciliRenk() }

    // Durum yazısı ve rahatsız etmeyin: şimdilik yerelde saklanır
    setLocalPresencePrefs({ dnd: q('[name=dnd]').checked, statusText: q('[name=status]').value })

    const dosya = q('[name=avatar]').files[0]
    if (dosya) {
      try { yeni.avatar_url = await uploadAvatar(dosya) } catch (e) { hata.textContent = e.message; return }
    }
    arka.remove()
    onSaved?.(yeni)
  }
}

// Oturum açık ama profili olmayan kullanıcı için tam ekran form.
// mesaj: ekranda baştan gösterilecek hata (örn. kullanıcı adı alınmış).
export function renderCompleteProfile(container, userId, onDone, mesaj = '') {
  container.innerHTML = `
    <div class="card">
      <h1>Profilini tamamla</h1>
      <label>Kullanıcı adı</label>
      <input type="text" name="username" maxlength="20" />
      <label>Renk</label>
      <div class="swatches"></div>
      <p class="error"></p>
      <button type="button" data-act="devam">Devam</button>
    </div>`
  const seciliRenk = renkSecici(container.querySelector('.swatches'), rastgeleRenk())
  const hata = container.querySelector('.error')
  hata.textContent = mesaj
  container.querySelector('[data-act=devam]').onclick = async () => {
    const ad = container.querySelector('[name=username]').value
    const adHatasi = validateUsername(ad)
    if (adHatasi) { hata.textContent = adHatasi; return }
    const sonuc = await createProfile(userId, ad, seciliRenk())
    if (sonuc.error) hata.textContent = sonuc.error
    else onDone()
  }
}
