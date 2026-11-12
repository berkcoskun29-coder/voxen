// Giriş / Kayıt ekranı: iki sekmeli bir form.
import { signIn, signUp } from './auth.js'

// container içine formu çizer. Başarılı olunca onDone() çağrılır.
export function renderAuthView(container, onDone) {
  let mod = 'giris' // 'giris' ya da 'kayit'

  function ciz() {
    const kayit = mod === 'kayit'
    container.innerHTML = `
      <div class="card">
        <h1 class="brand"><img src="/favicon.svg" alt="" width="32" height="32" />Voxen</h1>
        <div class="tabs">
          <button type="button" data-mod="giris" class="${kayit ? '' : 'active'}">Giriş</button>
          <button type="button" data-mod="kayit" class="${kayit ? 'active' : ''}">Kayıt</button>
        </div>
        <form>
          ${kayit ? '<label>Kullanıcı adı</label><input type="text" name="username" maxlength="20" required />' : ''}
          <label>E-posta</label>
          <input type="email" name="email" required />
          <label>Şifre</label>
          <input type="password" name="password" required />
          <p class="error"></p>
          <button type="submit">${kayit ? 'Kayıt ol' : 'Giriş yap'}</button>
        </form>
      </div>`

    // Sekme düğmeleri
    container.querySelectorAll('.tabs button').forEach((b) => {
      b.onclick = () => { mod = b.dataset.mod; ciz() }
    })

    const form = container.querySelector('form')
    const hata = container.querySelector('.error')
    form.onsubmit = async (e) => {
      e.preventDefault()
      const f = form.elements
      const dugme = form.querySelector('button[type=submit]')
      dugme.disabled = true
      hata.textContent = ''
      const sonuc = kayit
        ? await signUp(f.email.value, f.password.value, f.username.value)
        : await signIn(f.email.value, f.password.value)
      dugme.disabled = false
      if (sonuc.needsProfile) onDone(sonuc.error) // oturum açık, profil eksik: mesajı tamamlama formuna taşı
      else if (sonuc.error) hata.textContent = sonuc.error
      else onDone()
    }
  }

  ciz()
}
