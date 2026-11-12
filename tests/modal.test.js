// @vitest-environment jsdom
// Ortak pencere kalıbı (createModalShell) ve bu kalıba geçen pencereler:
// sunucu/kanal penceresi (openModal), ayarlar, tuş seçimi, mikrofon testi, profil.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Profil kaydı ve mikrofon Supabase'e / donanıma gitmesin
const fake = vi.hoisted(() => ({}))
vi.mock('../src/auth/auth.js', async (asil) => ({
  ...(await asil()),
  updateProfile: vi.fn(async () => fake.updateSonuc ?? {}),
  uploadAvatar: vi.fn(async () => 'https://ornek/resim.png'),
}))
vi.mock('../src/voice/pipeline.js', async (asil) => ({
  ...(await asil()),
  openMic: vi.fn(() => new Promise(() => {})), // varsayılan: mikrofon hiç cevap vermesin
  createVoicePipeline: vi.fn(),
}))

import { createModalShell, formAlani } from '../src/ui/modal.js'
import { openModal } from '../src/ui/layout.js'
import { openSettings, askPttKey } from '../src/ui/settings.js'
import { openMicTest } from '../src/ui/micTest.js'
import { openProfileModal } from '../src/auth/profileModal.js'
import { getSettings, updateSettings } from '../src/settings.js'
import { updateProfile } from '../src/auth/auth.js'

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  fake.updateSonuc = {}
})

// Tarayıcıdaki gibi: tuş olayı odaktaki öğeden başlar ve yukarı kabarır
const bas = (key, ek = {}) => {
  const hedef = document.activeElement ?? document.body
  hedef.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, ...ek }))
}
// Arka plana (pencerenin dışına) tıklama: basma ve bırakma ikisi de arka planda
const arkayaTikla = (arka) => {
  arka.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  arka.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}
const dugme = (yazi, kok = document) => [...kok.querySelectorAll('button')].find((b) => b.textContent === yazi)
const bekle = () => new Promise((r) => setTimeout(r, 0))

function alan(ad) {
  const i = document.createElement('input')
  i.type = 'text'; i.name = ad
  return i
}

describe('createModalShell', () => {
  it('başlık, X, Vazgeç ve yeşil ana düğme kurar; pencere rolü ve başlık bağlantısı vardır', () => {
    createModalShell({ baslik: 'Deneme', govde: [alan('a')], birincil: { yazi: 'Tamam', tik: async () => null } })
    const kart = document.querySelector('.modal-back [role=dialog]')
    expect(kart.getAttribute('aria-modal')).toBe('true')
    const h = kart.querySelector('h2')
    expect(h.textContent).toBe('Deneme')
    expect(kart.getAttribute('aria-labelledby')).toBe(h.id)
    expect(kart.querySelector('button[aria-label=Kapat]')).not.toBeNull()
    const serit = kart.querySelector('.modal-foot')
    expect([...serit.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Vazgeç', 'Tamam'])
  })

  it('Esc, X, Vazgeç ve arka plan tıklaması kapatır; onKapat bir kez çağrılır', () => {
    for (const kapatici of [
      () => bas('Escape'),
      () => document.querySelector('button[aria-label=Kapat]').click(),
      () => dugme('Vazgeç').click(),
      () => arkayaTikla(document.querySelector('.modal-back')),
    ]) {
      const onKapat = vi.fn()
      createModalShell({ baslik: 'X', govde: [alan('a')], onKapat })
      kapatici()
      expect(document.querySelector('.modal-back')).toBeNull()
      expect(onKapat).toHaveBeenCalledTimes(1)
    }
  })

  it('pencerenin içine tıklamak kapatmaz; içeride basılıp dışarıda bırakılan sürükleme de kapatmaz', () => {
    const { arka } = createModalShell({ baslik: 'X', govde: [alan('a')] })
    document.querySelector('.modal-body input').click()
    expect(arka.isConnected).toBe(true)
    // Yazı seçerken fare dışarı kaydı: mousedown içeride, click arka planda
    document.querySelector('.modal-body input').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    arka.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(arka.isConnected).toBe(true)
  })

  it('odak ilk alana gider, pencere içinde döner, kapanınca açan düğmeye geri döner', () => {
    const acan = document.createElement('button')
    acan.textContent = 'Aç'
    document.body.appendChild(acan)
    acan.focus()
    const a = alan('a')
    createModalShell({ baslik: 'X', govde: [a, alan('b')], birincil: { yazi: 'Tamam', tik: async () => null } })
    expect(document.activeElement).toBe(a)
    const son = dugme('Tamam')
    son.focus()
    bas('Tab')
    expect(document.activeElement).toBe(document.querySelector('button[aria-label=Kapat]')) // başa döndü
    bas('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(son) // sondan başa, baştan sona
    bas('Escape')
    expect(document.activeElement).toBe(acan)
  })

  it('açan düğme bu arada yeniden çizildiyse odak aynı anahtarlı yeni düğmeye döner', () => {
    const eski = document.createElement('button')
    eski.dataset.odak = 'ayarlar'
    document.body.appendChild(eski)
    eski.focus()
    const { kapat } = createModalShell({ baslik: 'Ayarlar' })
    // Panel yeniden çizildi: eski düğme gitti, yerine aynı anahtarlı yenisi geldi
    eski.remove()
    const yeni = document.createElement('button')
    yeni.dataset.odak = 'ayarlar'
    document.body.appendChild(yeni)
    kapat()
    expect(document.activeElement).toBe(yeni)
  })

  it('üst üste iki pencerede Esc yalnız üsttekini kapatır', () => {
    const alt = createModalShell({ baslik: 'Alt', govde: [alan('a')] })
    const ust = createModalShell({ baslik: 'Üst', govde: [alan('b')] })
    bas('Escape')
    expect(ust.arka.isConnected).toBe(false)
    expect(alt.arka.isConnected).toBe(true)
    bas('Escape')
    expect(alt.arka.isConnected).toBe(false)
  })

  it('kaydederken: ana düğme kilitli, Esc ve arka plan kapatmaz; hata metni pencereyi açık tutar', async () => {
    let bitir
    const tik = vi.fn(() => new Promise((r) => { bitir = r }))
    const { arka } = createModalShell({ baslik: 'X', govde: [alan('a')], birincil: { yazi: 'Kaydet', tik } })
    dugme('Kaydet').click()
    dugme('Kaydet').click() // çift tıklama ikinci kaydı başlatmaz
    expect(tik).toHaveBeenCalledTimes(1)
    expect(dugme('Kaydet').disabled).toBe(true)
    bas('Escape')
    arkayaTikla(arka)
    expect(arka.isConnected).toBe(true)
    bitir('Olmadı')
    await bekle()
    expect(arka.querySelector('.error').textContent).toBe('Olmadı')
    expect(dugme('Kaydet').disabled).toBe(false)
    expect(arka.isConnected).toBe(true)
  })

  it('kaydetme hata fırlatırsa mesaj .error satırında görünür, pencere açık kalır', async () => {
    const { arka } = createModalShell({ baslik: 'X', govde: [alan('a')], birincil: { yazi: 'Kaydet', tik: async () => { throw new Error('Ağ hatası') } } })
    dugme('Kaydet').click()
    await bekle()
    expect(arka.querySelector('.error').textContent).toBe('Ağ hatası')
    expect(arka.isConnected).toBe(true)
    expect(dugme('Kaydet').disabled).toBe(false)
    // Mesajsız hata: genel metin
    createModalShell({ baslik: 'Y', govde: [], birincil: { yazi: 'Tamam', tik: async () => { throw null } } })
    dugme('Tamam').click()
    await bekle()
    expect(document.querySelectorAll('.modal-back')[1].querySelector('.error').textContent).toBe('Bir hata oluştu')
  })

  it('kaydederken X ile kapatılır ve kayıt sonra başarısız olursa hata bildirimi çıkar', async () => {
    for (const sonuc of [(r, j) => r('Ad alınmış'), (r, j) => j(new Error('Ağ hatası'))]) {
      document.body.innerHTML = ''
      let bitir
      createModalShell({ baslik: 'X', govde: [alan('a')], birincil: { yazi: 'Kaydet', tik: () => new Promise((r, j) => { bitir = () => sonuc(r, j) }) } })
      dugme('Kaydet').click()
      document.querySelector('button[aria-label=Kapat]').click()
      expect(document.querySelector('.modal-back')).toBeNull()
      bitir()
      await bekle()
      const t = document.querySelector('.toast')
      expect(t.classList.contains('toast-hata')).toBe(true)
      expect(['Ad alınmış', 'Ağ hatası']).toContain(t.textContent)
    }
  })

  it('kaydederken kapatılıp kayıt başarılı biterse bildirim çıkmaz', async () => {
    let bitir
    createModalShell({ baslik: 'X', govde: [], birincil: { yazi: 'Kaydet', tik: () => new Promise((r) => { bitir = r }) } })
    dugme('Kaydet').click()
    dugme('Vazgeç').click()
    bitir(null)
    await bekle()
    expect(document.querySelector('.toast')).toBeNull()
  })

  it('tam ekrandayken Esc pencereyi kapatmaz (tam ekrandan çıkış tarayıcıya kalır)', () => {
    const { arka } = createModalShell({ baslik: 'X', govde: [alan('a')] })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.body })
    try {
      bas('Escape')
      expect(arka.isConnected).toBe(true)
    } finally { delete document.fullscreenElement }
  })
})

describe('openModal (sunucu oluştur / kanal ekle / sunucuya katıl)', () => {
  it('hata dönerse açık kalır, null dönerse kapanır; Vazgeç kaydetmeden kapatır', async () => {
    const onSubmit = vi.fn(async () => 'Ad boş olamaz')
    openModal('Sunucu oluştur', [alan('ad')], onSubmit)
    expect(document.querySelector('.modal-back h2').textContent).toBe('Sunucu oluştur')
    dugme('Oluştur').click()
    await bekle()
    expect(document.querySelector('.modal-back .error').textContent).toBe('Ad boş olamaz')
    onSubmit.mockImplementation(async () => null)
    dugme('Oluştur').click()
    await bekle()
    expect(document.querySelector('.modal-back')).toBeNull()

    const ikinci = vi.fn()
    openModal('Kanal ekle', [alan('ad')], ikinci)
    dugme('Vazgeç').click()
    expect(document.querySelector('.modal-back')).toBeNull()
    expect(ikinci).not.toHaveBeenCalled()
  })
})

describe('küçük pencerede Enter', () => {
  it('yazı kutusunda Enter ana düğmeye basar (sunucu oluştur / katıl / kanal ekle)', async () => {
    const onSubmit = vi.fn(async () => null)
    openModal('Sunucu oluştur', [alan('ad')], onSubmit)
    const kutu = document.querySelector('.modal-back input[name=ad]')
    expect(document.activeElement).toBe(kutu)
    bas('Enter')
    await bekle()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.modal-back')).toBeNull()
  })

  it('çok satırlı kutuda, yazı birleştirirken (IME) ve düğmelerde Enter göndermez', async () => {
    const onSubmit = vi.fn(async () => null)
    const metin = document.createElement('textarea')
    openModal('Kanal ekle', [alan('ad'), metin], onSubmit)
    metin.focus()
    bas('Enter')
    document.querySelector('.modal-back input[name=ad]').focus()
    bas('Enter', { isComposing: true })
    dugme('Vazgeç').focus()
    bas('Enter')
    await bekle()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('ana düğmesi olmayan / büyük pencerelerde (ayarlar) Enter bir şey göndermez', () => {
    const { arka } = createModalShell({ baslik: 'X', govde: [alan('a')] })
    bas('Enter')
    expect(arka.isConnected).toBe(true)
  })
})

describe('gürültü engelleme ayarlar ve mikrofon testinde aynı', () => {
  it('birinde değişince diğerindeki kutu da değişir', () => {
    updateSettings({ pttKey: 'KeyV', noiseSuppression: true })
    openSettings({})
    openMicTest()
    const ayarKutusu = document.getElementById('ayar-ns')
    const testKutusu = document.getElementById('mic-ns')
    expect(ayarKutusu.checked).toBe(true)
    expect(testKutusu.checked).toBe(true)
    // Mikrofon testinde kapat -> ayarlardaki kutu da kapanır
    testKutusu.checked = false
    testKutusu.dispatchEvent(new Event('change'))
    expect(getSettings().noiseSuppression).toBe(false)
    expect(ayarKutusu.checked).toBe(false)
    // Ayarlarda aç -> mikrofon testindeki kutu da açılır
    ayarKutusu.checked = true
    ayarKutusu.dispatchEvent(new Event('change'))
    expect(testKutusu.checked).toBe(true)
  })

  it('pencere kapanınca dinlemeyi bırakır (kapalı pencerenin kutusu güncellenmez)', () => {
    updateSettings({ noiseSuppression: true })
    const test = openMicTest()
    const testKutusu = document.getElementById('mic-ns')
    test.close()
    updateSettings({ noiseSuppression: false })
    expect(testKutusu.checked).toBe(true)
  })
})

describe('ayarlar penceresi', () => {
  it('bölüm başlıkları görünür ve etiket kutunun üstündedir', () => {
    updateSettings({ pttKey: 'KeyV' })
    openSettings({})
    const basliklar = [...document.querySelectorAll('.settings-section-title')].map((h) => h.textContent)
    expect(basliklar).toEqual(['Konuşma', 'Cihazlar', 'Ses kalitesi', 'Hesap'])
    // Etiket kutunun üstünde: aynı alan kutusunda önce label, sonra kontrol
    const mod = document.querySelector('select[data-ayar=mod]')
    expect(mod.previousElementSibling.tagName).toBe('LABEL')
    expect(mod.previousElementSibling.htmlFor).toBe(mod.id)
  })

  it('Esc ayarları kapatır ve yeniden açılabilir (tek pencere kuralı bozulmaz)', () => {
    updateSettings({ pttKey: 'KeyV' })
    openSettings({})
    bas('Escape')
    expect(document.querySelector('.modal-back')).toBeNull()
    openSettings({})
    openSettings({})
    expect(document.querySelectorAll('.modal-back')).toHaveLength(1)
  })

  it('"Çıkış yap" sakin ikincil düğmedir ve önce onay sorar; Vazgeç ve Esc hiçbir şey yapmaz', () => {
    updateSettings({ pttKey: 'KeyV' })
    const onSignOut = vi.fn()
    openSettings({ onSignOut })
    const cikis = dugme('Çıkış yap')
    expect(cikis.classList.contains('danger')).toBe(false) // dolu kırmızı değil
    expect(cikis.classList.contains('danger-outline')).toBe(true) // kırmızı çerçeve + yazı
    cikis.click()
    // Onay penceresi ayarların üstünde açılır
    expect(document.querySelectorAll('.modal-back')).toHaveLength(2)
    const onay = document.querySelectorAll('.modal-back')[1]
    expect(onay.querySelector('h2').textContent).toBe('Çıkış yapılsın mı?')
    expect(onSignOut).not.toHaveBeenCalled()
    dugme('Vazgeç', onay).click()
    expect(onSignOut).not.toHaveBeenCalled()
    expect(document.querySelectorAll('.modal-back')).toHaveLength(1) // ayarlar açık kaldı
    // Esc de yalnız onayı kapatır
    dugme('Çıkış yap').click()
    bas('Escape')
    expect(onSignOut).not.toHaveBeenCalled()
    expect(document.querySelectorAll('.modal-back')).toHaveLength(1)
    expect(document.querySelector('.modal-back h2').textContent).toBe('Ayarlar')
  })

  it('onay penceresinde "Çıkış yap" ayarları kapatır ve çıkış işleyicisini bir kez çağırır', async () => {
    updateSettings({ pttKey: 'KeyV' })
    const onSignOut = vi.fn()
    openSettings({ onSignOut })
    dugme('Çıkış yap').click()
    const onay = document.querySelectorAll('.modal-back')[1]
    const evet = dugme('Çıkış yap', onay)
    expect(evet.classList.contains('danger')).toBe(true) // onaydaki düğme kırmızı
    evet.click()
    await vi.waitFor(() => expect(document.querySelector('.modal-back')).toBeNull())
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('Profil düğmesi ayarları kapatıp profil penceresini açar', () => {
    updateSettings({ pttKey: 'KeyV' })
    const onProfile = vi.fn()
    openSettings({ onProfile })
    dugme('Profili düzenle').click()
    expect(onProfile).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.modal-back')).toBeNull()
  })

  it('M6: ayar sekme menüsünde aria-orientation yok (dar pencerede yatay dizilir)', () => {
    openSettings({})
    const menu = document.querySelector('[role=tablist]')
    expect(menu).not.toBeNull()
    expect(menu.hasAttribute('aria-orientation')).toBe(false)
    bas('Escape')
  })
})

describe('ayarlar menüsü (solda bölümler, sağda tek bölüm)', () => {
  const sekmeler = () => [...document.querySelectorAll('[role=tablist] [role=tab]')]
  const gorunenBolum = () => [...document.querySelectorAll('[role=tabpanel]')].filter((p) => !p.hidden)

  it('dört sekme vardır; ilk açılışta Konuşma seçilidir ve yalnız o bölüm görünür', () => {
    updateSettings({ pttKey: 'KeyV' })
    openSettings({})
    expect(sekmeler().map((t) => t.textContent)).toEqual(['Konuşma', 'Cihazlar', 'Ses kalitesi', 'Hesap'])
    expect(sekmeler()[0].getAttribute('aria-selected')).toBe('true')
    expect(gorunenBolum()).toHaveLength(1)
    expect(gorunenBolum()[0].getAttribute('aria-labelledby')).toBe(sekmeler()[0].id)
    expect(sekmeler()[0].getAttribute('aria-controls')).toBe(gorunenBolum()[0].id)
    // Seçili olmayan sekmeler Tab sırasında değil (oklarla gezilir)
    expect(sekmeler().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1])
  })

  it('sekmeye tıklayınca o bölüm görünür; ayarlar bölümler arasında yerinde kalır', () => {
    updateSettings({ pttKey: 'KeyV', mode: 'ptt' })
    openSettings({})
    const mod = document.querySelector('select[data-ayar=mod]')
    mod.value = 'vad'
    mod.dispatchEvent(new Event('change'))
    sekmeler()[3].click()
    expect(sekmeler()[3].getAttribute('aria-selected')).toBe('true')
    expect(sekmeler()[0].getAttribute('aria-selected')).toBe('false')
    expect(gorunenBolum()[0].contains(dugme('Profili düzenle'))).toBe(true)
    sekmeler()[0].click()
    // Aynı kutu: değer korunur, ayar canlı kaydedilmiş
    expect(document.querySelector('select[data-ayar=mod]')).toBe(mod)
    expect(mod.value).toBe('vad')
    expect(getSettings().mode).toBe('vad')
  })

  it('ok tuşlarıyla sekmeler arasında gezilir (başa/sona sarar), Home ve End uçlara gider', () => {
    updateSettings({ pttKey: 'KeyV' })
    openSettings({})
    sekmeler()[0].focus()
    bas('ArrowDown')
    expect(document.activeElement).toBe(sekmeler()[1])
    expect(sekmeler()[1].getAttribute('aria-selected')).toBe('true')
    bas('ArrowRight')
    expect(document.activeElement).toBe(sekmeler()[2])
    bas('ArrowUp')
    bas('ArrowLeft')
    expect(document.activeElement).toBe(sekmeler()[0])
    bas('ArrowUp') // baştan sona sarar
    expect(document.activeElement).toBe(sekmeler()[3])
    expect(gorunenBolum()[0].getAttribute('aria-labelledby')).toBe(sekmeler()[3].id)
    bas('Home')
    expect(document.activeElement).toBe(sekmeler()[0])
    bas('End')
    expect(document.activeElement).toBe(sekmeler()[3])
    expect(sekmeler().map((t) => t.tabIndex)).toEqual([-1, -1, -1, 0])
  })

  it('pencere açılınca odak başlığa gider (ilk kutuya değil)', () => {
    updateSettings({ pttKey: 'KeyV' })
    openSettings({})
    expect(document.activeElement).toBe(document.querySelector('.modal-back h2'))
  })

  it('son açılan bölüm hatırlanır', () => {
    updateSettings({ pttKey: 'KeyV' })
    openSettings({})
    sekmeler()[2].click()
    bas('Escape')
    expect(sekmeler()).toHaveLength(0)
    openSettings({})
    expect(sekmeler()[2].getAttribute('aria-selected')).toBe('true')
    expect(gorunenBolum()[0].getAttribute('aria-labelledby')).toBe(sekmeler()[2].id)
  })

  it('depolama kapalıysa (hata fırlatırsa) pencere yine Konuşma ile açılır ve gezilir', () => {
    updateSettings({ pttKey: 'KeyV' })
    const oku = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('kapalı') })
    const yaz = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('kapalı') })
    try {
      openSettings({})
      expect(sekmeler()[0].getAttribute('aria-selected')).toBe('true')
      sekmeler()[1].click()
      expect(sekmeler()[1].getAttribute('aria-selected')).toBe('true')
    } finally {
      oku.mockRestore()
      yaz.mockRestore()
    }
  })

  it('bilinmeyen kayıtlı bölüm adı yok sayılır', () => {
    updateSettings({ pttKey: 'KeyV' })
    localStorage.setItem('voxen.ayarlarBolum', 'yok-boyle-bolum')
    openSettings({})
    expect(sekmeler()[0].getAttribute('aria-selected')).toBe('true')
  })
})


describe('tuş seçimi penceresi', () => {
  it('ayarların üstündeyken Esc yalnız tuş seçimini kapatır ve vazgeçme sayılır', () => {
    updateSettings({ mode: 'ptt', pttKey: null })
    openSettings({}) // tuş yok: tuş seçimi ayarların üstünde kendiliğinden açılır
    expect(document.querySelectorAll('.modal-back')).toHaveLength(2)
    bas('Escape')
    expect(getSettings().pttKey).toBeNull()
    expect(document.querySelectorAll('.modal-back')).toHaveLength(1) // ayarlar açık kaldı
    expect(document.querySelector('.modal-back h2').textContent).toBe('Ayarlar')
  })

  it('Vazgeç düğmesi ve arka plan tıklaması da vazgeçme sayılır', () => {
    const onDone = vi.fn()
    askPttKey(null, onDone)
    dugme('Vazgeç').click()
    expect(onDone).toHaveBeenLastCalledWith(null)
    expect(document.querySelector('.modal-back')).toBeNull()

    askPttKey(null, onDone)
    arkayaTikla(document.querySelector('.modal-back'))
    expect(onDone).toHaveBeenLastCalledWith(null)
    expect(document.querySelector('.modal-back')).toBeNull()
  })

  it('"Dinliyorum… bir tuşa bas" der; basılan tuşun adı görünür ama onaylanmadan kaydedilmez', () => {
    const onDone = vi.fn()
    askPttKey(null, onDone)
    const kutu = document.querySelector('.key-listen')
    expect(kutu.textContent).toBe('Dinliyorum… bir tuşa bas')
    expect(kutu.classList.contains('dinliyor')).toBe(true) // nabız animasyonu
    expect(kutu.getAttribute('aria-live')).toBe('polite')
    const kaydet = dugme('Kaydet')
    expect(kaydet.disabled).toBe(true) // tuş seçilmeden onaylanamaz
    bas('KeyB')
    bas('KeyV') // başka tuşa basınca seçim değişir
    expect(kutu.textContent).toBe('V')
    expect(kutu.classList.contains('dinliyor')).toBe(false)
    expect(kaydet.disabled).toBe(false)
    expect(getSettings().pttKey).toBeNull()
    expect(onDone).not.toHaveBeenCalled()
    expect(document.querySelector('.modal-back')).not.toBeNull()
    bas('Escape') // pencere açık kalmasın (tuş dinleyicisi sonraki testlere sızmasın)
  })

  it('Kaydet düğmesi seçilen tuşu kaydeder', async () => {
    const onDone = vi.fn()
    askPttKey(null, onDone)
    bas('KeyV')
    dugme('Kaydet').click()
    await vi.waitFor(() => expect(document.querySelector('.modal-back')).toBeNull())
    expect(getSettings().pttKey).toBe('KeyV')
    expect(onDone).toHaveBeenLastCalledWith('KeyV')
  })

  it('tuş seçildikten sonra Enter onaylar; ilk basılan Enter ise tuş olarak seçilir', () => {
    const onDone = vi.fn()
    askPttKey(null, onDone)
    bas('KeyV')
    bas('Enter')
    expect(getSettings().pttKey).toBe('KeyV')
    expect(onDone).toHaveBeenLastCalledWith('KeyV')
    expect(document.querySelector('.modal-back')).toBeNull()

    askPttKey(null, onDone)
    bas('Enter')
    expect(document.querySelector('.key-listen').textContent).toBe('Enter')
    expect(document.querySelector('.modal-back')).not.toBeNull()
    bas('Escape')
  })

  it('tuş seçildikten sonra Esc yine yalnız vazgeçer (kaydetmez)', () => {
    updateSettings({ pttKey: 'KeyF' })
    const onDone = vi.fn()
    askPttKey(null, onDone)
    bas('KeyV')
    bas('Escape')
    expect(onDone).toHaveBeenLastCalledWith(null)
    expect(getSettings().pttKey).toBe('KeyF')
    expect(document.querySelector('.modal-back')).toBeNull()
  })

  it('ayarların üstünde açılınca arka plan ikinci kez kararmaz', () => {
    updateSettings({ mode: 'ptt', pttKey: null })
    openSettings({})
    const [alt, ust] = document.querySelectorAll('.modal-back')
    expect(alt.classList.contains('ust-uste')).toBe(false)
    expect(ust.classList.contains('ust-uste')).toBe(true)
    bas('Escape')
  })
})


describe('mikrofon testi penceresi', () => {
  it('Kapat ve Esc pencereyi kapatır', () => {
    openMicTest()
    expect(document.querySelector('.modal-back h2').textContent).toBe('Mikrofon testi')
    dugme('Kapat').click()
    expect(document.querySelector('.modal-back')).toBeNull()
    openMicTest()
    bas('Escape')
    expect(document.querySelector('.modal-back')).toBeNull()
  })
})

describe('mikrofon testi: mikrofon açıldıktan sonra kapanınca hat kapanır', () => {
  it('Esc ve arka plan tıklaması hat.close() çağırır', async () => {
    const { openMic, createVoicePipeline } = await import('../src/voice/pipeline.js')
    for (const kapatici of [() => bas('Escape'), () => arkayaTikla(document.querySelector('.modal-back'))]) {
      const hat = { close: vi.fn(), getLevel: () => 0, setNoiseSuppression: vi.fn(), setGate: vi.fn(), outputStream: {} }
      openMic.mockImplementationOnce(async () => ({ getTracks: () => [] }))
      createVoicePipeline.mockImplementationOnce(async () => hat)
      openMicTest()
      await vi.waitFor(() => expect(createVoicePipeline).toHaveBeenCalled())
      await bekle()
      kapatici()
      expect(document.querySelector('.modal-back')).toBeNull()
      expect(hat.close).toHaveBeenCalledTimes(1)
      createVoicePipeline.mockClear()
    }
  })
})

describe('profil penceresi', () => {
  const profil = { id: 'u1', username: 'berk', color: '#5b7cfa' }

  it('dosya kutusu gizli; "Resim değiştir" onu açar; önizleme 72px avatar', () => {
    openProfileModal(profil)
    const dosya = document.querySelector('input[type=file]')
    expect(dosya.hidden).toBe(true)
    const tikla = vi.fn()
    dosya.addEventListener('click', tikla)
    dugme('Resim değiştir').click()
    expect(tikla).toHaveBeenCalled()
    const onizleme = document.querySelector('.profile-preview')
    expect(onizleme.textContent).toBe('B')
  })

  it('renk düğmelerinin adı var ve "Renk" başlığı grubun etiketi', () => {
    openProfileModal(profil)
    const grup = document.querySelector('.swatches')
    expect(grup.getAttribute('role')).toBe('group')
    const etiket = document.getElementById(grup.getAttribute('aria-labelledby'))
    expect(etiket.textContent).toBe('Renk')
    expect(etiket.tagName).not.toBe('LABEL') // label yalnız tek bir alana bağlanır; grup için değil
    const adlar = [...grup.querySelectorAll('.swatch')].map((b) => b.getAttribute('aria-label'))
    expect(adlar).toHaveLength(8)
    expect(adlar.every((a) => a && a.length > 0)).toBe(true)
    expect(new Set(adlar).size).toBe(8) // hepsi farklı
    expect(adlar[0]).toBe('Mavi')
  })

  it('renk seçilince önizleme anında o renge döner', () => {
    openProfileModal(profil)
    const onizleme = document.querySelector('.profile-preview')
    expect(onizleme.style.background).toBe('rgb(91, 124, 250)')
    const yesil = [...document.querySelectorAll('.swatch')].find((b) => b.dataset.color !== profil.color)
    yesil.click()
    expect(yesil.classList.contains('selected')).toBe(true)
    expect(onizleme.style.background).toBe(yesil.style.background)
  })

  it('Kaydet: geçersiz adda açık kalır; geçerli adda kaydedip kapanır; Vazgeç kaydetmez', async () => {
    const onSaved = vi.fn()
    openProfileModal(profil, onSaved)
    const ad = document.querySelector('[name=username]')
    ad.value = ''
    dugme('Kaydet').click()
    await bekle()
    expect(document.querySelector('.modal-back .error').textContent).not.toBe('')
    expect(updateProfile).not.toHaveBeenCalled()
    ad.value = 'yeniad'
    dugme('Kaydet').click()
    await vi.waitFor(() => expect(document.querySelector('.modal-back')).toBeNull())
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ username: 'yeniad' }))

    openProfileModal(profil, onSaved)
    dugme('Vazgeç').click()
    expect(document.querySelector('.modal-back')).toBeNull()
    expect(onSaved).toHaveBeenCalledTimes(1)
  })
})

// U07: pencerelerde kutu altı hata
describe('pencerede kutu altı hata (formAlani)', () => {
  it('etiket for/id ile kutuya bağlı; hata satırı aria-describedby ile bağlı ve başta boş', () => {
    const f = formAlani('Sunucu adı', alan('ad'))
    expect(f.etiket.tagName).toBe('LABEL')
    expect(f.etiket.htmlFor).toBe(f.input.id)
    expect(f.input.id).not.toBe('')
    expect(f.hata.classList.contains('field-error')).toBe(true)
    expect(f.input.getAttribute('aria-describedby')).toContain(f.hata.id)
    expect(f.hata.textContent).toBe('')
  })
  it('{ alan, metin } dönen tik: hata kutunun altına, kutu aria-invalid ve odakta; genel satır boş', async () => {
    const f = formAlani('Sunucu adı', alan('ad'))
    const tik = vi.fn(async () => ({ alan: f.input, metin: 'Sunucu adı boş olamaz.' }))
    openModal('Sunucu oluştur', [f.etiket, f.input, f.hata], tik)
    dugme('Vazgeç').focus()
    dugme('Oluştur').click()
    await bekle()
    expect(f.hata.textContent).toBe('Sunucu adı boş olamaz.')
    expect(f.input.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(f.input)
    expect(document.querySelector('.modal-back .error').textContent).toBe('')
    // Yazmaya başlayınca hata kalkar
    f.input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(f.hata.textContent).toBe('')
    expect(f.input.hasAttribute('aria-invalid')).toBe(false)
  })
  it('yeniden basınca eski kutu hatası temizlenir; düz metin hata genel satıra gider', async () => {
    const f = formAlani('Ad', alan('ad'))
    const tik = vi.fn(async () => ({ alan: f.input, metin: 'Kutu hatası' }))
    openModal('Kanal ekle', [f.etiket, f.input, f.hata], tik)
    dugme('Oluştur').click()
    await bekle()
    tik.mockImplementation(async () => 'Genel hata')
    dugme('Oluştur').click()
    await bekle()
    expect(f.hata.textContent).toBe('')
    expect(f.input.hasAttribute('aria-invalid')).toBe(false)
    expect(document.querySelector('.modal-back .error').textContent).toBe('Genel hata')
  })
})
