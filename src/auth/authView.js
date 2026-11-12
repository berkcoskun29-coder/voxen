// Giriş / Kayıt ekranı: tek şeritte iki sekme ve bir form.
// Hatalar ilgili kutunun hemen altına yazılır (kırmızı kenar + aria-invalid + aria-describedby);
// hangi kutuyla ilgili olmayan hatalar düğmenin üstündeki genel satıra yazılır.
//
// Ayrıca "Şifremi unuttum" (e-postaya sıfırlama linki) ve linkten dönünce açılan
// "Yeni şifre belirle" formu da burada (akışın tamamı: src/auth/recovery.js).
import { signIn, signUp, validateUsername, requestPasswordReset, updatePassword } from './auth.js'
import { eyeIcon } from '../ui/icons.js'

const SLOGAN = 'Arkadaşlarınla, reklamsız ve ücretsiz.'
const LOGO = '<img src="/favicon.svg" alt="" width="32" height="32" />'
// Sıfırlama e-postası: kayıtlı olsun olmasın aynı metin (kimin kayıtlı olduğu dışarıdan anlaşılmasın)
const SIFIRLAMA_GONDERILDI = 'Bu e-posta kayıtlıysa sıfırlama linki gönderildi. Gelen kutunu ve spam klasörünü kontrol et.'
// Supabase'in ücretsiz e-posta gönderimi saatte birkaç e-postayla sınırlı: dürüstçe söyleriz
const SIFIRLAMA_SINIR_NOTU = 'Ücretsiz planda e-posta sayısı sınırlı; gelmezse birkaç dakika sonra tekrar dene.'
const EPOSTA_KALIBI = /^\S+@\S+\.\S+$/

// Bir giriş kutusu: etiket + kutu + (başta boş) hata satırı. Hata satırının id'si kutuya aria-describedby ile bağlanır.
// ek: kutuya bağlanacak ek açıklama id'si (örn. şifre ipucu); ekstra: hata satırının altına konacak HTML.
// sifre: true ise kutunun sağında "şifreyi göster" düğmesi olur; etiketYani: etiketin sağına konacak HTML.
function alanHtml({ etiket, ad, tur, ek = '', ekstra = '', ozel = '', sifre = false, etiketYani = '' }) {
  const bag = `hata-${ad}` + (ek ? ` ${ek}` : '')
  const etiketHtml = `<label for="giris-${ad}">${etiket}</label>`
  const kutu = `<input id="giris-${ad}" type="${tur}" name="${ad}" ${ozel} aria-describedby="${bag}" />`
  return `
    ${etiketYani ? `<div class="label-row">${etiketHtml}${etiketYani}</div>` : etiketHtml}
    ${sifre
      ? `<div class="input-wrap">${kutu}<button type="button" class="password-toggle" aria-label="Şifreyi göster" aria-pressed="false" aria-controls="giris-${ad}"></button></div>`
      : kutu}
    <p class="field-error" id="hata-${ad}"></p>${ekstra}`
}

// "Şifreyi göster" düğmelerini çalıştırır: kutunun türü password ↔ text olur, aria-pressed değişir.
// Fareyle basınca odak kutuda kalır (mousedown engellenir) ve imlecin yeri korunur.
function sifreGosterKur(kok) {
  kok.querySelectorAll('.password-toggle').forEach((dugme) => {
    const kutu = kok.querySelector(`#${dugme.getAttribute('aria-controls')}`)
    dugme.replaceChildren(eyeIcon(true))
    dugme.addEventListener('mousedown', (e) => e.preventDefault())
    dugme.onclick = () => {
      const gorunur = kutu.type === 'password' // şimdi gösterilecek mi?
      const odakKutudaydi = document.activeElement === kutu
      const [bas, son] = [kutu.selectionStart, kutu.selectionEnd]
      kutu.type = gorunur ? 'text' : 'password'
      dugme.setAttribute('aria-pressed', String(gorunur))
      dugme.replaceChildren(eyeIcon(!gorunur)) // gösterilirken üstü çizili göz ("gizle")
      if (odakKutudaydi) {
        kutu.focus()
        try { kutu.setSelectionRange(bas, son) } catch { /* bazı türlerde imleç yok */ }
      }
    }
  })
}

// Formdaki kutu hatalarını yöneten küçük yardımcılar (giriş, sıfırlama ve yeni şifre formları ortak kullanır)
function formHatalari(kok, form) {
  const genelHata = kok.querySelector('.error')
  // Kutunun hata satırına metni yazar (boşsa temizler), aria-invalid ile kenarı kırmızı yapar; kutu yoksa false döner
  function alanHatasi(ad, metin) {
    const kutu = form.elements[ad]
    const satir = kok.querySelector(`#hata-${ad}`)
    if (!kutu || !satir) return false // bu formda böyle bir kutu yok
    satir.textContent = metin ?? ''
    if (metin) kutu.setAttribute('aria-invalid', 'true')
    else kutu.removeAttribute('aria-invalid')
    return true
  }
  function hepsiniTemizle() {
    for (const kutu of form.elements) if (kutu.name) alanHatasi(kutu.name, '')
    genelHata.textContent = ''
  }
  // { ad: metin } hatalarını yazar ve ilk hatalı kutuya odaklanır; hata yoksa false
  function hatalariYaz(hatalar) {
    const ilk = Object.keys(hatalar)[0]
    if (!ilk) return false
    for (const [ad, metin] of Object.entries(hatalar)) alanHatasi(ad, metin)
    form.elements[ilk].focus()
    return true
  }
  // Sunucudan gelen { error, alan } sonucu: kutuyla ilgiliyse onun altına, değilse genel satıra
  function sonucuYaz(sonuc) {
    if (sonuc.alan && alanHatasi(sonuc.alan, sonuc.error)) form.elements[sonuc.alan].focus()
    else genelHata.textContent = sonuc.error
  }
  // Kutuya yazmaya başlayınca o kutunun hatası kalkar
  for (const kutu of form.elements) {
    if (kutu.name) kutu.addEventListener('input', () => alanHatasi(kutu.name, ''))
  }
  return { genelHata, alanHatasi, hepsiniTemizle, hatalariYaz, sonucuYaz }
}

// container içine formu çizer. Başarılı olunca onDone() çağrılır.
// secenek: { mod: 'giris' | 'kayit' | 'unuttum', mesaj: açılışta genel satırda gösterilecek metin }
export function renderAuthView(container, onDone, { mod: ilkMod = 'giris', mesaj = '' } = {}) {
  let mod = ilkMod // 'giris', 'kayit' ya da 'unuttum'
  let eposta = '' // sekme değişince yazılan e-posta kaybolmasın

  function modaGec(yeni) {
    const kutu = container.querySelector('[name=email]')
    if (kutu) eposta = kutu.value
    mod = yeni
    mesaj = ''
    ciz()
  }

  function ciz() {
    if (mod === 'unuttum') return cizUnuttum()
    const kayit = mod === 'kayit'
    container.innerHTML = `
      <div class="card">
        <h1 class="brand">${LOGO}Voxen</h1>
        <p class="tagline">${SLOGAN}</p>
        <div class="tabs" role="tablist">
          <button type="button" role="tab" data-mod="giris" class="${kayit ? '' : 'active'}" aria-selected="${!kayit}">Giriş</button>
          <button type="button" role="tab" data-mod="kayit" class="${kayit ? 'active' : ''}" aria-selected="${kayit}">Kayıt</button>
        </div>
        <form novalidate>
          ${kayit ? alanHtml({ etiket: 'Kullanıcı adı', ad: 'username', tur: 'text', ozel: 'maxlength="20" autocomplete="username"' }) : ''}
          ${alanHtml({ etiket: 'E-posta', ad: 'email', tur: 'email', ozel: 'autocomplete="email"' })}
          ${alanHtml({
            etiket: 'Şifre', ad: 'password', tur: 'password', sifre: true,
            ozel: `autocomplete="${kayit ? 'new-password' : 'current-password'}"`,
            ek: kayit ? 'ipucu-password' : '',
            ekstra: kayit ? '<p class="field-hint" id="ipucu-password">En az 8 karakter</p>' : '',
          })}
          ${kayit ? '' : '<div class="forgot-row"><button type="button" class="link-btn" data-act="unuttum">Şifremi unuttum</button></div>'}
          <p class="error" role="alert"></p>
          <button type="submit" class="block">${kayit ? 'Kayıt ol' : 'Giriş yap'}</button>
        </form>
      </div>`

    // Sekme düğmeleri
    container.querySelectorAll('.tabs button').forEach((b) => {
      b.onclick = () => modaGec(b.dataset.mod)
    })
    const unuttum = container.querySelector('[data-act=unuttum]')
    if (unuttum) unuttum.onclick = () => modaGec('unuttum')
    sifreGosterKur(container)

    const form = container.querySelector('form')
    form.elements.email.value = eposta
    const h = formHatalari(container, form)
    h.genelHata.textContent = mesaj

    // Ağa gitmeden önce kutuları kontrol eder: { ad: metin } döner (boşsa her şey yolunda)
    function kontrol(f) {
      const hatalar = {}
      if (kayit) {
        const adHatasi = validateUsername(f.username.value)
        if (adHatasi) hatalar.username = adHatasi
      }
      if (!EPOSTA_KALIBI.test(f.email.value.trim())) hatalar.email = 'Geçerli bir e-posta gir'
      if (kayit) {
        if (f.password.value.length < 8) hatalar.password = 'Şifre en az 8 karakter olmalı'
      } else if (!f.password.value) {
        hatalar.password = 'Şifreni yaz'
      }
      return hatalar
    }

    form.onsubmit = async (e) => {
      e.preventDefault()
      const f = form.elements
      h.hepsiniTemizle()
      if (h.hatalariYaz(kontrol(f))) return

      const dugme = form.querySelector('button[type=submit]')
      dugme.disabled = true
      const sonuc = kayit
        ? await signUp(f.email.value.trim(), f.password.value, f.username.value)
        : await signIn(f.email.value.trim(), f.password.value)
      dugme.disabled = false
      if (sonuc.needsProfile) onDone(sonuc.error) // oturum açık, profil eksik: mesajı tamamlama formuna taşı
      else if (sonuc.error) h.sonucuYaz(sonuc)
      else onDone()
    }
  }

  // "Şifremi unuttum": e-posta yazılır, sıfırlama linki gönderilir
  function cizUnuttum() {
    container.innerHTML = `
      <div class="card">
        <h1 class="brand">${LOGO}Voxen</h1>
        <h2 class="card-title">Şifreni sıfırla</h2>
        <p class="tagline">E-postanı yaz, şifreni yenilemen için bir link gönderelim.</p>
        <form novalidate>
          ${alanHtml({ etiket: 'E-posta', ad: 'email', tur: 'email', ozel: 'autocomplete="email"' })}
          <p class="error" role="alert"></p>
          <button type="submit" class="block">Sıfırlama linki gönder</button>
        </form>
        <button type="button" class="link-btn back-link" data-act="geri">Girişe dön</button>
      </div>`
    const kart = container.querySelector('.card')
    container.querySelector('[data-act=geri]').onclick = () => modaGec('giris')
    const form = container.querySelector('form')
    const kutu = form.elements.email
    kutu.value = eposta
    kutu.focus()
    const h = formHatalari(container, form)
    h.genelHata.textContent = mesaj

    form.onsubmit = async (e) => {
      e.preventDefault()
      h.hepsiniTemizle()
      const adres = kutu.value.trim()
      if (h.hatalariYaz(EPOSTA_KALIBI.test(adres) ? {} : { email: 'Geçerli bir e-posta gir' })) return

      const dugme = form.querySelector('button[type=submit]')
      dugme.disabled = true
      const sonuc = await requestPasswordReset(adres)
      dugme.disabled = false
      if (sonuc.error) return h.sonucuYaz(sonuc)

      // Gönderildi: form yerine tarafsız bilgi kutusu (ekran okuyucu da okusun: role="status")
      const bilgi = document.createElement('div')
      bilgi.className = 'notice'
      bilgi.setAttribute('role', 'status')
      const p1 = document.createElement('p')
      p1.textContent = SIFIRLAMA_GONDERILDI
      const p2 = document.createElement('p')
      p2.className = 'hint'
      p2.textContent = SIFIRLAMA_SINIR_NOTU
      bilgi.append(p1, p2)
      form.replaceWith(bilgi)
      eposta = adres
      kart.querySelector('[data-act=geri]').focus()
    }
  }

  ciz()
}

// Sıfırlama linkinden dönen kullanıcı için "Yeni şifre belirle" formu.
// onDone(): şifre kaydedildi; onCikis(): kullanıcı şifre koymadan çıkmak istedi.
export function renderNewPasswordView(container, { onDone, onCikis }) {
  container.innerHTML = `
    <div class="card">
      <h1 class="brand">${LOGO}Voxen</h1>
      <h2 class="card-title">Yeni şifre belirle</h2>
      <p class="tagline">Hesabın için yeni bir şifre seç. Kaydedince uygulamaya geçersin.</p>
      <form novalidate>
        ${alanHtml({
          etiket: 'Yeni şifre', ad: 'password', tur: 'password', sifre: true,
          ozel: 'autocomplete="new-password"', ek: 'ipucu-password',
          ekstra: '<p class="field-hint" id="ipucu-password">En az 8 karakter</p>',
        })}
        ${alanHtml({ etiket: 'Yeni şifre (tekrar)', ad: 'password2', tur: 'password', sifre: true, ozel: 'autocomplete="new-password"' })}
        <p class="error" role="alert"></p>
        <button type="submit" class="block">Şifreyi kaydet</button>
      </form>
      <button type="button" class="link-btn back-link" data-act="cikis">Çıkış yap</button>
    </div>`
  sifreGosterKur(container)
  container.querySelector('[data-act=cikis]').onclick = () => onCikis?.()
  const form = container.querySelector('form')
  const f = form.elements
  const h = formHatalari(container, form)
  f.password.focus()

  form.onsubmit = async (e) => {
    e.preventDefault()
    h.hepsiniTemizle()
    const hatalar = {}
    if (f.password.value.length < 8) hatalar.password = 'Şifre en az 8 karakter olmalı'
    else if (f.password2.value !== f.password.value) hatalar.password2 = 'Şifreler aynı değil. İki kutuya da aynı şifreyi yaz.'
    if (h.hatalariYaz(hatalar)) return

    const dugme = form.querySelector('button[type=submit]')
    dugme.disabled = true
    const sonuc = await updatePassword(f.password.value)
    dugme.disabled = false
    if (sonuc.error) h.sonucuYaz(sonuc)
    else onDone?.()
  }
}
