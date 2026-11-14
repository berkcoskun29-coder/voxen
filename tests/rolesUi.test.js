// @vitest-environment jsdom
// Roller arayüzü (v0.11.0): Sunucu ayarları > Roller sekmesi, sekmeli ayarlar penceresi, kanal menüsü taşıma,
// sunucu menüsünün izinlere göre öğeleri, çıkarma onayı.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountRolesPanel } from '../src/ui/roles.js'
import { serverSettingsDialog, openServerMenu, openChannelMenu, closeMenu, kickMemberDialog } from '../src/ui/serverMenu.js'
import { yetkiHesapla } from '../src/data/rolKurallari.js'

const SAHIP = 'sahip'
const server = { id: 's1', name: 'Takım', owner_id: SAHIP, invite_code: 'abc12345' }
const herkes = { id: 'r0', name: '@herkes', position: 0, is_default: true, permissions: [], color: null, hoist: false }
const yonetici = { id: 'r3', name: 'Yönetici', position: 3, is_default: false, permissions: ['MANAGE_ROLES', 'MANAGE_MESSAGES'], color: 'kirmizi', hoist: true }
const mod = { id: 'r2', name: 'Mod', position: 2, is_default: false, permissions: ['MANAGE_MESSAGES'], color: null, hoist: false }
const dj = { id: 'r1', name: 'DJ', position: 1, is_default: false, permissions: ['MANAGE_CHANNELS'], color: 'mavi', hoist: false }
const roles = [herkes, dj, mod, yonetici]
const memberRoles = [{ user_id: 'ali', role_id: 'r3' }]

beforeEach(() => {
  closeMenu()
  document.body.innerHTML = ''
})

function kur(userId = SAHIP, rolListesi = roles) {
  const durum = { roles: rolListesi, yetki: yetkiHesapla({ server, roles: rolListesi, memberRoles, userId }) }
  const islemler = {
    olustur: vi.fn(async () => 'yeni'),
    kaydet: vi.fn(async () => {}),
    sil: vi.fn(async () => {}),
    tasi: vi.fn(async () => {}),
  }
  const panel = mountRolesPanel({ getDurum: () => durum, islemler })
  document.body.appendChild(panel.el)
  return { panel, islemler, durum }
}
const satirlar = () => [...document.querySelectorAll('.role-row')]
const satir = (ad) => satirlar().find((s) => s.querySelector('.role-name').textContent === ad)
const dugme = (yazi, kok = document) => [...kok.querySelectorAll('button')].find((b) => b.textContent === yazi)

describe('Roller paneli', () => {
  it('liste en yüksek üstte, @herkes en altta; renk noktası tema değişkeni; @herkes oksuz', () => {
    kur()
    expect(satirlar().map((s) => s.querySelector('.role-name').textContent)).toEqual(['Yönetici', 'Mod', 'DJ', '@herkes'])
    expect(satir('DJ').querySelector('.role-dot').style.background).toBe('var(--rol-mavi)')
    expect(satir('Mod').querySelector('.role-dot').classList.contains('renksiz')).toBe(true)
    expect(satir('@herkes').querySelector('.role-up')).toBeNull()
    expect(satir('Yönetici').querySelector('.role-up').disabled).toBe(true) // en üstte
    expect(satir('DJ').querySelector('.role-down').disabled).toBe(true) // en altta
    expect(satir('Yönetici').querySelector('.role-up').getAttribute('aria-label')).toBe('Yönetici rolünü yukarı taşı')
  })

  it('↑ ↓ düğmeleri hedef sırayla taşır', async () => {
    const { islemler } = kur()
    satir('Mod').querySelector('.role-up').click()
    await vi.waitFor(() => expect(islemler.tasi).toHaveBeenCalledWith(mod, 3))
    satir('Mod').querySelector('.role-down').click()
    await vi.waitFor(() => expect(islemler.tasi).toHaveBeenLastCalledWith(mod, 1))
  })

  it('sürükle-bırak: bırakılan rolün sırasına taşır', async () => {
    const { islemler } = kur()
    const kaynak = satir('DJ')
    expect(kaynak.draggable).toBe(true)
    kaynak.dispatchEvent(new Event('dragstart'))
    const hedef = satir('Yönetici')
    const uzerinde = new Event('dragover', { cancelable: true })
    hedef.dispatchEvent(uzerinde)
    expect(uzerinde.defaultPrevented).toBe(true)
    expect(hedef.classList.contains('drag-over')).toBe(true)
    hedef.dispatchEvent(new Event('drop', { cancelable: true }))
    await vi.waitFor(() => expect(islemler.tasi).toHaveBeenCalledWith(dj, 3))
  })

  it('düzenleyici: ad, renk (radiogroup), ayrı göster, izinler (açıklamalı); Kaydet değerleri gönderir', async () => {
    const { islemler } = kur()
    satir('DJ').querySelector('.role-select').click()
    const ed = document.querySelector('.role-editor')
    const ad = ed.querySelector('input[type=text]')
    expect(ad.value).toBe('DJ')
    expect(ad.maxLength).toBe(30)
    ad.value = ' Müzik '
    ad.dispatchEvent(new Event('input'))
    const renkler = [...ed.querySelectorAll('[role=radio]')]
    expect(renkler).toHaveLength(9)
    expect(ed.querySelector('[role=radiogroup]').getAttribute('aria-label')).toBe('Rol rengi')
    expect(renkler.find((r) => r.getAttribute('aria-checked') === 'true').getAttribute('aria-label')).toBe('Mavi')
    renkler.find((r) => r.getAttribute('aria-label') === 'Mor').click()
    const izinler = [...ed.querySelectorAll('.role-perm')]
    expect(izinler).toHaveLength(6)
    expect(izinler[0].textContent).toContain('Kanal açma, adlandırma, silme ve sıralama.')
    izinler.find((l) => l.textContent.includes('Üye çıkar')).querySelector('input').click()
    ed.querySelector('.role-check input').click()
    dugme('Kaydet', ed).click()
    await vi.waitFor(() => expect(islemler.kaydet).toHaveBeenCalledWith(dj, { name: 'Müzik', color: 'mor', permissions: ['MANAGE_CHANNELS', 'KICK_MEMBERS'], hoist: true }))
  })

  it('renk seçiminde ok tuşları gezer ve seçer', () => {
    kur()
    satir('DJ').querySelector('.role-select').click()
    const renkler = [...document.querySelectorAll('[role=radio]')]
    const secili = renkler.find((r) => r.tabIndex === 0)
    secili.focus()
    secili.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.activeElement.getAttribute('aria-label')).toBe('Mor')
    expect(document.activeElement.getAttribute('aria-checked')).toBe('true')
  })

  it('boş ad kaydedilmez; hata satırında söylenir', async () => {
    const { islemler } = kur()
    satir('Mod').querySelector('.role-select').click()
    const ad = document.querySelector('.role-editor input[type=text]')
    ad.value = '  '
    dugme('Kaydet', document.querySelector('.role-editor')).click()
    expect(islemler.kaydet).not.toHaveBeenCalled()
    expect(document.querySelector('.roles-error').textContent).toContain('Rol adı boş olamaz')
  })

  it('"Rolü sil" onay ister; onaylayınca siler', async () => {
    const { islemler } = kur()
    satir('Mod').querySelector('.role-select').click()
    dugme('Rolü sil').click()
    const onay = [...document.querySelectorAll('.modal-card')].at(-1)
    expect(onay.textContent).toContain('"Mod" rolü silinsin mi?')
    expect(islemler.sil).not.toHaveBeenCalled()
    dugme('Sil', onay).click()
    await vi.waitFor(() => expect(islemler.sil).toHaveBeenCalledWith(mod))
  })

  it('@herkes: yalnız izinler (ad/renk/sil yok)', () => {
    kur()
    satir('@herkes').querySelector('.role-select').click()
    const ed = document.querySelector('.role-editor')
    expect(ed.querySelector('input[type=text]')).toBeNull()
    expect(ed.querySelector('[role=radiogroup]')).toBeNull()
    expect(dugme('Rolü sil', ed)).toBeUndefined()
    expect(ed.querySelectorAll('.role-perm input:not(:disabled)')).toHaveLength(6)
  })

  it('sahip olmayan yönetici: kendi rolü ve üstü kilitli; sende olmayan izin pasif; @herkes izinleri düzenlenebilir', () => {
    kur('ali')
    expect(satir('Yönetici').classList.contains('kilitli')).toBe(true)
    expect(satir('Mod').classList.contains('kilitli')).toBe(false)
    expect(satir('Mod').querySelector('.role-up').disabled).toBe(true) // hedef 3 = Ali'nin sırası
    expect(satir('DJ').querySelector('.role-up').disabled).toBe(false)
    satir('Yönetici').querySelector('.role-select').click()
    let ed = document.querySelector('.role-editor')
    expect(ed.textContent).toContain('Bu rol senin en yüksek rolünden aşağıda değil.')
    expect(ed.querySelector('input[type=text]').disabled).toBe(true)
    expect(dugme('Kaydet', ed)).toBeUndefined()
    satir('@herkes').querySelector('.role-select').click()
    ed = document.querySelector('.role-editor')
    const acik = [...ed.querySelectorAll('.role-perm input:not(:disabled)')].map((k) => k.value)
    expect(acik.sort()).toEqual(['MANAGE_MESSAGES', 'MANAGE_ROLES'])
  })

  it('v0.12 (v11 K3): yetkisi yalnız @herkes üzerinden gelen (rolsüz) kişide "Rol oluştur" gizli', () => {
    const herkesYonetir = roles.map((r) => (r.is_default ? { ...r, permissions: ['MANAGE_ROLES'] } : r))
    kur('rolsuz', herkesYonetir)
    expect(document.querySelector('.roles-create').hidden).toBe(true)
  })

  it('yetkisiz: oluştur düğmesi yok, her şey kilitli', () => {
    kur('yabanci')
    expect(document.querySelector('.roles-create').hidden).toBe(true)
    expect(satirlar().every((s) => s.classList.contains('kilitli'))).toBe(true)
  })

  it('Rol oluştur yeni rolü seçer; hata panelde gösterilir', async () => {
    const { islemler, panel, durum } = kur()
    document.querySelector('.roles-create').click()
    await vi.waitFor(() => expect(islemler.olustur).toHaveBeenCalled())
    await Promise.resolve(); await Promise.resolve()
    durum.roles = [...roles, { id: 'yeni', name: 'yeni rol', position: 1, is_default: false, permissions: [], color: null, hoist: false }]
    panel.yenile()
    expect(document.querySelector('.role-row.secili .role-name').textContent).toBe('yeni rol')
    islemler.olustur.mockRejectedValueOnce(new Error('Bir sunucuda en fazla 50 rol olabilir.'))
    document.querySelector('.roles-create').click()
    await vi.waitFor(() => expect(document.querySelector('.roles-error').textContent).toBe('Bir sunucuda en fazla 50 rol olabilir.'))
  })

  it('canlı yenileme: kaydedilmemiş ad kaybolmaz; silinen seçili rol bırakılır', () => {
    const { panel, durum } = kur()
    satir('Mod').querySelector('.role-select').click()
    const ad = document.querySelector('.role-editor input[type=text]')
    ad.value = 'Yazılan'
    ad.dispatchEvent(new Event('input'))
    durum.roles = roles.map((r) => (r.id === 'r1' ? { ...r, name: 'DJ2' } : r))
    panel.yenile()
    expect(satir('DJ2')).toBeTruthy()
    expect(document.querySelector('.role-editor input[type=text]').value).toBe('Yazılan')
    durum.roles = roles.filter((r) => r.id !== 'r2')
    panel.yenile()
    expect(document.querySelector('.role-editor').textContent).toContain('Düzenlemek için soldan bir rol seç.')
  })
})

describe('Sunucu ayarları sekmeleri', () => {
  it('roller verilince Genel ve Roller sekmeleri; Kaydet yalnız Genel sekmesinde; kapanınca panel kapanır', () => {
    const kapat = vi.fn()
    const ic = document.createElement('div')
    ic.className = 'icerik'
    const p = serverSettingsDialog(server, { kaydet: vi.fn(), kopyala: vi.fn(), roller: () => ({ el: ic, kapat }) })
    const sekmeler = [...document.querySelectorAll('[role=tab]')]
    expect(sekmeler.map((s) => s.textContent)).toEqual(['Genel', 'Roller'])
    expect(sekmeler[0].getAttribute('aria-selected')).toBe('true')
    expect(p.anaDugme.hidden).toBe(false)
    sekmeler[1].click()
    expect(document.getElementById('sunucu-bolum-roller').hidden).toBe(false)
    expect(document.getElementById('sunucu-bolum-genel').hidden).toBe(true)
    expect(p.anaDugme.hidden).toBe(true)
    sekmeler[1].focus()
    sekmeler[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(document.activeElement).toBe(sekmeler[0])
    p.kapat()
    expect(kapat).toHaveBeenCalled()
  })

  it('MANAGE_SERVER yoksa yalnız Roller sekmesi, Kaydet yok', () => {
    const p = serverSettingsDialog(server, { kaydet: vi.fn(), kopyala: vi.fn(), genel: false, roller: () => ({ el: document.createElement('div') }) })
    expect([...document.querySelectorAll('[role=tab]')].map((s) => s.textContent)).toEqual(['Roller'])
    expect(p.anaDugme).toBeNull()
    expect(document.querySelector('.invite-code')).toBeNull()
  })

  it('Davet kodunu yenile: onaydan sonra yeni kod görünür; hata pencerede kalır', async () => {
    const yenile = vi.fn().mockResolvedValueOnce('Bunu yapmaya yetkin yok.').mockResolvedValueOnce({ kod: 'yeni1234' })
    serverSettingsDialog(server, { kaydet: vi.fn(), kopyala: vi.fn(), yenile })
    dugme('Davet kodunu yenile').click()
    let onay = [...document.querySelectorAll('.modal-card')].at(-1)
    expect(onay.textContent).toContain('Eski davet linkleri artık çalışmaz.')
    dugme('Yenile', onay).click()
    await vi.waitFor(() => expect(onay.querySelector('.error').textContent).toBe('Bunu yapmaya yetkin yok.'))
    dugme('Yenile', onay).click()
    await vi.waitFor(() => expect(document.querySelector('.invite-code').textContent).toBe('yeni1234'))
    expect(document.querySelector('.invite-renew-status').textContent).toBe('Davet kodu yenilendi.')
  })
})

describe('menüler', () => {
  const opener = () => { const d = document.createElement('button'); document.body.appendChild(d); return d }
  const ogeler = () => [...document.querySelectorAll('.popup-menu [role=menuitem]')].map((b) => b.textContent)

  it('sunucu menüsü izinlere göre: ayarlar (sunucu/rol yönetimi), kanal ekle; sil yalnız sahipte', () => {
    openServerMenu({ opener: opener(), sunucu: server, sahip: false, izinler: new Set(['MANAGE_ROLES']), tik: {} })
    expect(ogeler()).toEqual(['Davet et', 'Sunucuyu sessize al', 'Sunucu ayarları', 'Sunucudan ayrıl'])
    closeMenu()
    openServerMenu({ opener: opener(), sunucu: server, sahip: false, izinler: new Set(['MANAGE_CHANNELS', 'MANAGE_SERVER']), tik: {} })
    expect(ogeler()).toEqual(['Davet et', 'Sunucuyu sessize al', 'Sunucu ayarları', 'Kanal ekle', 'Sunucudan ayrıl'])
    closeMenu()
    openServerMenu({ opener: opener(), sunucu: server, sahip: false, izinler: new Set(['KICK_MEMBERS']), tik: {} })
    expect(ogeler()).toEqual(['Davet et', 'Sunucuyu sessize al', 'Sunucudan ayrıl'])
  })

  it('kanal menüsü: taşıma öğeleri yalnız işlev verilince', () => {
    const onMoveUp = vi.fn()
    openChannelMenu({ opener: opener(), kanal: { name: 'genel' }, tik: { onMoveUp, onMoveDown: vi.fn() } })
    expect(ogeler()).toEqual(['Kanalı yeniden adlandır', 'Yukarı taşı', 'Aşağı taşı', 'Kanalı sil'])
    ;[...document.querySelectorAll('.popup-menu [role=menuitem]')][1].click()
    expect(onMoveUp).toHaveBeenCalled()
    openChannelMenu({ opener: opener(), kanal: { name: 'genel' }, tik: { onMoveDown: vi.fn() } })
    expect(ogeler()).toEqual(['Kanalı yeniden adlandır', 'Aşağı taşı', 'Kanalı sil'])
  })

  it('çıkarma onayı: kişi ve sunucu adı, kırmızı Çıkar', () => {
    const cikar = vi.fn(async () => null)
    kickMemberDialog({ username: 'ayla' }, server, cikar)
    expect(document.querySelector('.modal-card').textContent).toContain('ayla, Takım sunucusundan çıkarılsın mı?')
    const b = dugme('Çıkar')
    expect(b.className).toBe('danger')
    b.click()
    expect(cikar).toHaveBeenCalled()
  })
})
