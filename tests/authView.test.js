// @vitest-environment jsdom
// Giriş/kayıt kartı (T13): sekmeler, slogan, alan altı hatalar.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = { signIn: vi.fn(), signUp: vi.fn(), reset: vi.fn(), update: vi.fn() }
vi.mock('../src/lib/supabase.js', () => ({ supabase: {} }))
vi.mock('../src/auth/auth.js', async (orijinal) => ({
  ...(await orijinal()),
  signIn: (...a) => fake.signIn(...a),
  signUp: (...a) => fake.signUp(...a),
  requestPasswordReset: (...a) => fake.reset(...a),
  updatePassword: (...a) => fake.update(...a),
}))
const { renderAuthView, renderNewPasswordView } = await import('../src/auth/authView.js')

let kap, onDone
function ac(mod = 'giris') {
  kap = document.createElement('div')
  document.body.replaceChildren(kap)
  onDone = vi.fn()
  renderAuthView(kap, onDone)
  if (mod === 'kayit') kap.querySelector('[data-mod=kayit]').click()
}
const yaz = (ad, deger) => { kap.querySelector(`[name=${ad}]`).value = deger }
const gonder = async () => {
  kap.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 0))
}
// Bir kutunun hata satırı (aria-describedby ile bağlı olan)
const hataSatiri = (ad) => {
  const girdi = kap.querySelector(`[name=${ad}]`)
  const idler = (girdi.getAttribute('aria-describedby') ?? '').split(' ')
  return idler.map((i) => kap.querySelector(`#${i}`)).find((e) => e?.classList.contains('field-error')) ?? null
}
const gecersiz = (ad) => kap.querySelector(`[name=${ad}]`).getAttribute('aria-invalid') === 'true'

beforeEach(() => { for (const f of Object.values(fake)) f.mockReset() })

describe('giriş kartı yapısı', () => {
  it('logonun altında tek satırlık slogan var', () => {
    ac()
    expect(kap.querySelector('.tagline').textContent).toBe('Arkadaşlarınla, reklamsız ve ücretsiz.')
  })
  it('sekmeler tek şeritte; seçili sekme aria-selected ve active', () => {
    ac()
    const [g, k] = kap.querySelectorAll('.tabs button')
    expect(g.classList.contains('active')).toBe(true)
    expect(g.getAttribute('aria-selected')).toBe('true')
    expect(k.getAttribute('aria-selected')).toBe('false')
    k.click()
    expect(kap.querySelector('.tabs button.active').dataset.mod).toBe('kayit')
  })
  it('ana düğme tam genişlik sınıfı taşır', () => {
    ac()
    expect(kap.querySelector('button[type=submit]').classList.contains('block')).toBe(true)
  })
  it('şifre kutusunun altında "En az 8 karakter" ipucu var ve kutuya bağlı (yalnız kayıtta)', () => {
    ac('kayit')
    const ipucu = kap.querySelector('.field-hint')
    expect(ipucu.textContent).toBe('En az 8 karakter')
    expect(kap.querySelector('[name=password]').getAttribute('aria-describedby')).toContain(ipucu.id)
    ac()
    expect(kap.querySelector('.field-hint')).toBeNull()
  })
})

describe('alan altı hatalar', () => {
  it('kısa kullanıcı adı: hata KULLANICI ADI kutusunun altında, yalnız o kutu kırmızı', async () => {
    ac('kayit')
    yaz('username', 'ab'); yaz('email', 'a@b.com'); yaz('password', '12345678')
    await gonder()
    expect(hataSatiri('username').textContent).toBe('Kullanıcı adı en az 3 karakter olmalı')
    expect(gecersiz('username')).toBe(true)
    expect(gecersiz('email')).toBe(false)
    expect(gecersiz('password')).toBe(false)
    expect(kap.querySelector('[name=username]').nextElementSibling).toBe(hataSatiri('username')) // kutunun hemen altında
    expect(fake.signUp).not.toHaveBeenCalled() // ağa gitmeden
  })
  it('kısa şifre: hata şifre kutusunun altında', async () => {
    ac('kayit')
    yaz('username', 'abc'); yaz('email', 'a@b.com'); yaz('password', '123')
    await gonder()
    expect(hataSatiri('password').textContent).toBe('Şifre en az 8 karakter olmalı')
    expect(gecersiz('password')).toBe(true)
    expect(gecersiz('username')).toBe(false)
  })
  it('geçersiz e-posta: hata e-posta kutusunun altında', async () => {
    ac()
    yaz('email', 'yanlis'); yaz('password', 'sifre1234')
    await gonder()
    expect(hataSatiri('email').textContent).toBe('Geçerli bir e-posta gir')
    expect(fake.signIn).not.toHaveBeenCalled()
  })
  it('sunucudan gelen alanlı hata (kullanıcı adı alınmış) ilgili kutunun altına yazılır', async () => {
    ac('kayit')
    fake.signUp.mockResolvedValue({ error: 'Bu kullanıcı adı alınmış', alan: 'username' })
    yaz('username', 'deneme'); yaz('email', 'a@b.com'); yaz('password', '12345678')
    await gonder()
    expect(hataSatiri('username').textContent).toBe('Bu kullanıcı adı alınmış')
    expect(gecersiz('username')).toBe(true)
  })
  it('alanı olmayan hata düğmenin üstündeki genel satıra yazılır', async () => {
    ac()
    fake.signIn.mockResolvedValue({ error: 'Bir şeyler ters gitti' })
    yaz('email', 'a@b.com'); yaz('password', 'sifre1234')
    await gonder()
    expect(kap.querySelector('.error').textContent).toBe('Bir şeyler ters gitti')
    expect(kap.querySelectorAll('[aria-invalid=true]').length).toBe(0)
  })
  it('kutuya yazmaya başlayınca o kutunun hatası kalkar', async () => {
    ac('kayit')
    yaz('username', 'ab'); yaz('email', 'a@b.com'); yaz('password', '12345678')
    await gonder()
    kap.querySelector('[name=username]').dispatchEvent(new Event('input', { bubbles: true }))
    expect(gecersiz('username')).toBe(false)
    expect(hataSatiri('username')?.textContent ?? '').toBe('')
  })
  it('başarılı girişte onDone çağrılır', async () => {
    ac()
    fake.signIn.mockResolvedValue({ user: { id: 'u1' } })
    yaz('email', 'a@b.com'); yaz('password', 'sifre1234')
    await gonder()
    expect(onDone).toHaveBeenCalledWith()
  })
})

// U11: şifreyi göster düğmesi
describe('şifreyi göster', () => {
  it('düğme aria-pressed ile şifreyi gösterir/gizler; odak ve imleç kutuda kalır', () => {
    ac()
    const kutu = kap.querySelector('[name=password]')
    const dugme = kap.querySelector('.password-toggle')
    expect(dugme.getAttribute('aria-label')).toBe('Şifreyi göster')
    expect(dugme.getAttribute('aria-pressed')).toBe('false')
    expect(dugme.getAttribute('aria-controls')).toBe(kutu.id)
    kutu.value = 'gizli123'
    kutu.focus()
    kutu.setSelectionRange(3, 3)
    // Fareyle basınca odak düğmeye kaçmasın
    const bas = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    dugme.dispatchEvent(bas)
    expect(bas.defaultPrevented).toBe(true)
    dugme.click()
    expect(kutu.type).toBe('text')
    expect(dugme.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(kutu)
    expect(kutu.selectionStart).toBe(3)
    dugme.click()
    expect(kutu.type).toBe('password')
    expect(dugme.getAttribute('aria-pressed')).toBe('false')
  })
  it('kayıt sekmesinde de var', () => {
    ac('kayit')
    expect(kap.querySelector('.password-toggle')).not.toBeNull()
  })
})

// U11: şifremi unuttum
describe('şifremi unuttum', () => {
  const unuttum = () => kap.querySelector('[data-act=unuttum]')
  it('yalnız giriş sekmesinde, şifre etiketinin yanında', () => {
    ac('kayit')
    expect(unuttum()).toBeNull()
    ac()
    expect(unuttum().textContent).toBe('Şifremi unuttum')
  })
  it('M8: Tab sırası e-posta, şifre, (göster düğmesi), Şifremi unuttum', () => {
    ac()
    const sira = [...kap.querySelectorAll('input, button')]
    const i = (e) => sira.indexOf(e)
    expect(i(kap.querySelector('[name=email]'))).toBeLessThan(i(kap.querySelector('[name=password]')))
    expect(i(kap.querySelector('[name=password]'))).toBeLessThan(i(unuttum()))
  })
  it('girişte yazılan e-posta sıfırlama formuna taşınır; geçersiz e-postada istek atılmaz', async () => {
    ac()
    yaz('email', 'yan')
    unuttum().click()
    expect(kap.querySelector('[name=password]')).toBeNull()
    expect(kap.querySelector('[name=email]').value).toBe('yan')
    expect(document.activeElement).toBe(kap.querySelector('[name=email]'))
    await gonder()
    expect(hataSatiri('email').textContent).toBe('Geçerli bir e-posta gir')
    expect(fake.reset).not.toHaveBeenCalled()
  })
  it('gönderince tarafsız başarı metni ve e-posta sınırı notu görünür', async () => {
    ac()
    unuttum().click()
    fake.reset.mockResolvedValue({ ok: true })
    yaz('email', ' a@b.com ')
    await gonder()
    expect(fake.reset).toHaveBeenCalledWith('a@b.com')
    const durum = kap.querySelector('[role=status]')
    expect(durum.textContent).toContain('Bu e-posta kayıtlıysa sıfırlama linki gönderildi. Gelen kutunu ve spam klasörünü kontrol et.')
    expect(durum.textContent).toContain('Ücretsiz planda e-posta sayısı sınırlı; gelmezse birkaç dakika sonra tekrar dene.')
    expect(kap.querySelector('form')).toBeNull()
  })
  it('hız sınırı hatası genel satıra yazılır, form kalır', async () => {
    ac()
    unuttum().click()
    fake.reset.mockResolvedValue({ error: 'Çok fazla deneme yapıldı. Birkaç dakika bekleyip tekrar dene.' })
    yaz('email', 'a@b.com')
    await gonder()
    expect(kap.querySelector('.error').textContent).toBe('Çok fazla deneme yapıldı. Birkaç dakika bekleyip tekrar dene.')
    expect(kap.querySelector('form')).not.toBeNull()
  })
  it('"Girişe dön" giriş formuna döner', () => {
    ac()
    unuttum().click()
    kap.querySelector('[data-act=geri]').click()
    expect(kap.querySelector('[name=password]')).not.toBeNull()
  })
  it('açılışta verilen mesaj (ör. süresi dolmuş link) sıfırlama formunda görünür', () => {
    kap = document.createElement('div')
    document.body.replaceChildren(kap)
    renderAuthView(kap, vi.fn(), { mod: 'unuttum', mesaj: 'Link eski' })
    expect(kap.querySelector('.error').textContent).toBe('Link eski')
    expect(kap.querySelector('[name=email]')).not.toBeNull()
  })
})

// U11: linkten dönünce yeni şifre formu
describe('yeni şifre formu', () => {
  let bitti, cikis
  function yeni() {
    kap = document.createElement('div')
    document.body.replaceChildren(kap)
    bitti = vi.fn(); cikis = vi.fn()
    renderNewPasswordView(kap, { onDone: bitti, onCikis: cikis })
  }
  it('iki şifre kutusu, şifreyi göster ve odak ilk kutuda', () => {
    yeni()
    expect(kap.querySelector('h2').textContent).toBe('Yeni şifre belirle')
    expect(kap.querySelector('[name=password]').getAttribute('autocomplete')).toBe('new-password')
    expect(kap.querySelector('[name=password2]')).not.toBeNull()
    expect(kap.querySelectorAll('.password-toggle').length).toBe(2)
    expect(document.activeElement).toBe(kap.querySelector('[name=password]'))
  })
  it('kısa şifre ve eşleşmeyen tekrar kutuların altında; istek atılmaz', async () => {
    yeni()
    yaz('password', '123'); yaz('password2', '123')
    await gonder()
    expect(hataSatiri('password').textContent).toBe('Şifre en az 8 karakter olmalı')
    yaz('password', 'yenisifre1'); yaz('password2', 'yenisifre2')
    await gonder()
    expect(hataSatiri('password2').textContent).toBe('Şifreler aynı değil. İki kutuya da aynı şifreyi yaz.')
    expect(gecersiz('password2')).toBe(true)
    expect(fake.update).not.toHaveBeenCalled()
  })
  it('geçerli şifre kaydedilir ve onDone çağrılır', async () => {
    yeni()
    fake.update.mockResolvedValue({ ok: true })
    yaz('password', 'yenisifre1'); yaz('password2', 'yenisifre1')
    await gonder()
    expect(fake.update).toHaveBeenCalledWith('yenisifre1')
    expect(bitti).toHaveBeenCalled()
  })
  it('sunucu hatası ilgili kutuya, onDone çağrılmaz', async () => {
    yeni()
    fake.update.mockResolvedValue({ error: 'Yeni şifre eskisiyle aynı olamaz. Başka bir şifre seç.', alan: 'password' })
    yaz('password', 'yenisifre1'); yaz('password2', 'yenisifre1')
    await gonder()
    expect(hataSatiri('password').textContent).toBe('Yeni şifre eskisiyle aynı olamaz. Başka bir şifre seç.')
    expect(bitti).not.toHaveBeenCalled()
  })
  it('"Çıkış yap" onCikis çağırır', () => {
    yeni()
    kap.querySelector('[data-act=cikis]').click()
    expect(cikis).toHaveBeenCalled()
  })
})
