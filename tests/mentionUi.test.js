// @vitest-environment jsdom
// @bahsetme arayüzü (src/ui/mentions.js + chatView): öneri listesinin klavye davranışı,
// @ad etiketleri, seni anan mesajın vurgusu. Ağ yok: sohbete sahte bir kaynak verilir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/lib/supabase.js', () => ({ supabase: {} }))

import { bahsetmeliMetin, imlectekiSorgu, oneriler, mountMentionSuggest, ONERI_SINIRI } from '../src/ui/mentions.js'
import { mountChat } from '../src/ui/chatView.js'
import { installProfileCards, closeProfileCard } from '../src/ui/profileCard.js'

const ben = { id: 'u1', username: 'berk', color: '#5b7cfa', avatar_url: null }
const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
const alper = { id: 'u3', username: 'Alper', color: '#3be37a', avatar_url: null }
const can = { id: 'u4', username: 'can', color: '#e0a05b', avatar_url: null }
const uyeler = [ben, ali, alper, can]

const tus = (el, key, extra = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
  el.dispatchEvent(e)
  return e
}
// Kutuya yazar: değer + imleç sonda + input olayı (tarayıcıdaki gibi)
const yaz = (kutu, metin) => {
  kutu.value = metin
  kutu.setSelectionRange(metin.length, metin.length)
  kutu.dispatchEvent(new Event('input', { bubbles: true }))
}
const adlar = (liste) => [...liste.querySelectorAll('.mention-option-name')].map((e) => e.textContent)
const secili = (liste) => liste.querySelector('.mention-option.selected .mention-option-name')?.textContent
const bosalt = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }

afterEach(() => { closeProfileCard(); document.body.innerHTML = '' })

describe('imlectekiSorgu', () => {
  it('imlecin solundaki @parçayı bulur; e-posta ve boşluktan sonrasını almaz', () => {
    expect(imlectekiSorgu('@', 1)).toEqual({ bas: 0, sorgu: '' })
    expect(imlectekiSorgu('selam @al', 9)).toEqual({ bas: 6, sorgu: 'al' })
    expect(imlectekiSorgu('(@al', 4)).toEqual({ bas: 1, sorgu: 'al' })
    expect(imlectekiSorgu('a@al', 4)).toBeNull()
    expect(imlectekiSorgu('@ali selam', 10)).toBeNull()
    expect(imlectekiSorgu('@al selam', 3)).toEqual({ bas: 0, sorgu: 'al' }) // imleç ortada
    expect(imlectekiSorgu('selam', 5)).toBeNull()
  })
})

describe('oneriler', () => {
  it('önce adı sorguyla başlayanlar, sonra adında geçenler; kendimiz yok; büyük-küçük harf duyarsız', () => {
    const k = { id: 'u5', username: 'malik', color: '#000', avatar_url: null }
    expect(oneriler([...uyeler, k], 'al', 'u1').map((u) => u.username)).toEqual(['ali', 'Alper', 'malik'])
    expect(oneriler(uyeler, 'BER', 'u1')).toEqual([])
    expect(oneriler(uyeler, '', 'u1').map((u) => u.username)).toEqual(['ali', 'Alper', 'can'])
  })

  it('en fazla 8 kişi', () => {
    const cok = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, username: `kisi${i}`, color: '#000' }))
    expect(ONERI_SINIRI).toBe(8)
    expect(oneriler(cok, 'kisi')).toHaveLength(8)
  })
})

describe('öneri listesi (klavye)', () => {
  let kutu, oneri, enterDinleyici
  beforeEach(() => {
    kutu = document.createElement('textarea')
    document.body.appendChild(kutu)
    oneri = mountMentionSuggest(kutu, { getMembers: () => uyeler, selfId: 'u1' })
    document.body.appendChild(oneri.el)
    // chatView'in gönderme dinleyicisi gibi: öneri tuşu kullandıysa bir şey yapmaz
    enterDinleyici = vi.fn()
    kutu.addEventListener('keydown', (e) => { if (!e.defaultPrevented && e.key === 'Enter') enterDinleyici() })
    kutu.focus()
  })

  it('@ yazınca açılır, yazılana göre süzülür, uyan yoksa kapanır', () => {
    expect(oneri.isOpen()).toBe(false)
    yaz(kutu, '@')
    expect(oneri.isOpen()).toBe(true)
    expect(adlar(oneri.el)).toEqual(['ali', 'Alper', 'can'])
    expect(kutu.getAttribute('aria-expanded')).toBe('true')
    yaz(kutu, '@al')
    expect(adlar(oneri.el)).toEqual(['ali', 'Alper'])
    yaz(kutu, '@zz')
    expect(oneri.isOpen()).toBe(false)
    expect(kutu.getAttribute('aria-expanded')).toBe('false')
  })

  it('e-posta yazarken açılmaz', () => {
    yaz(kutu, 'ben@al')
    expect(oneri.isOpen()).toBe(false)
  })

  it('↑↓ gezer (uçlarda döner), aria-activedescendant seçiliyi gösterir', () => {
    yaz(kutu, '@')
    expect(secili(oneri.el)).toBe('ali')
    expect(tus(kutu, 'ArrowDown').defaultPrevented).toBe(true)
    expect(secili(oneri.el)).toBe('Alper')
    tus(kutu, 'ArrowDown')
    tus(kutu, 'ArrowDown')
    expect(secili(oneri.el)).toBe('ali') // sondan başa
    tus(kutu, 'ArrowUp')
    expect(secili(oneri.el)).toBe('can') // baştan sona
    const id = kutu.getAttribute('aria-activedescendant')
    expect(document.getElementById(id).getAttribute('aria-selected')).toBe('true')
    expect(document.getElementById(id).querySelector('.mention-option-name').textContent).toBe('can')
  })

  it('Enter seçer: "@ad " yazılır, liste kapanır, mesaj gönderilmez', () => {
    yaz(kutu, 'selam @al')
    tus(kutu, 'ArrowDown')
    const e = tus(kutu, 'Enter')
    expect(e.defaultPrevented).toBe(true)
    expect(kutu.value).toBe('selam @Alper ')
    expect(kutu.selectionStart).toBe('selam @Alper '.length)
    expect(oneri.isOpen()).toBe(false)
    expect(enterDinleyici).not.toHaveBeenCalled()
    // Liste kapalıyken Enter yine gönderir
    tus(kutu, 'Enter')
    expect(enterDinleyici).toHaveBeenCalledTimes(1)
  })

  it('Tab da seçer; imleçten sonraki yazı korunur', () => {
    kutu.value = '@a sonra'
    kutu.setSelectionRange(2, 2)
    kutu.dispatchEvent(new Event('input', { bubbles: true }))
    expect(tus(kutu, 'Tab').defaultPrevented).toBe(true)
    expect(kutu.value).toBe('@ali  sonra')
  })

  it('Esc kapatır ve olay yukarı (ör. açık pencereye) gitmez', () => {
    const disari = vi.fn()
    document.body.addEventListener('keydown', disari)
    yaz(kutu, '@')
    tus(kutu, 'Escape')
    expect(oneri.isOpen()).toBe(false)
    expect(disari).not.toHaveBeenCalled()
    // Kapalıyken Esc'e karışmaz
    tus(kutu, 'Escape')
    expect(disari).toHaveBeenCalledTimes(1)
    document.body.removeEventListener('keydown', disari)
  })

  it('fareyle tıklayınca seçer', () => {
    yaz(kutu, '@c')
    oneri.el.querySelector('.mention-option').click()
    expect(kutu.value).toBe('@can ')
  })

  it('kutu odağı kaybedince kapanır; destroy dinleyicileri bırakır', () => {
    yaz(kutu, '@')
    kutu.dispatchEvent(new Event('blur'))
    expect(oneri.isOpen()).toBe(false)
    oneri.destroy()
    yaz(kutu, '@')
    expect(oneri.isOpen()).toBe(false)
  })

  it('ad HTML olarak çalışmaz (textContent)', () => {
    const kotu = { id: 'k', username: '<img src=x onerror=alert(1)>', color: '#000' }
    const o2 = mountMentionSuggest(kutu, { getMembers: () => [kotu] })
    yaz(kutu, '@')
    expect(o2.el.querySelector('img')).toBeNull()
    expect(o2.el.textContent).toContain('<img')
    o2.destroy()
  })
})

describe('bahsetmeliMetin', () => {
  const kur = (metin, liste = uyeler) => {
    const d = document.createElement('div')
    d.appendChild(bahsetmeliMetin(metin, liste))
    return d
  }

  it('üye olan @ad etiket olur; üye olmayan düz yazı kalır; metin aynen korunur', () => {
    const d = kur('selam @ALI ve @yabanci, @alper.')
    const etiketler = [...d.querySelectorAll('.mention')]
    expect(etiketler.map((e) => e.textContent)).toEqual(['@ALI', '@alper'])
    expect(d.textContent).toBe('selam @ALI ve @yabanci, @alper.')
    expect(etiketler[0].dataset.profileOpener).toBe('u2')
  })

  it('kelime sınırı: @alican ve x@ali etiket olmaz', () => {
    expect(kur('@alican x@ali').querySelector('.mention')).toBeNull()
  })

  it('linkin içindeki @ etiket olmaz; link yine link', () => {
    const d = kur('bak https://site.com/@ali ve @ali')
    expect(d.querySelector('a.msg-link').textContent).toBe('https://site.com/@ali')
    expect(d.querySelectorAll('.mention')).toHaveLength(1)
  })

  it('HTML çalışmaz', () => {
    const d = kur('<b>@ali</b>')
    expect(d.querySelector('b')).toBeNull()
    expect(d.textContent).toBe('<b>@ali</b>')
  })

  it('etikete tıklayınca o kişinin profil kartı açılır', () => {
    const d = kur('@can')
    document.body.appendChild(d)
    const birak = installProfileCards(document.body, () => ({ status: 'offline', statusText: '', voiceChannelName: null }))
    d.querySelector('.mention').click()
    expect(document.querySelector('.profile-card .profile-card-name').textContent).toBe('can')
    birak()
  })
})

// --- chatView ile birlikte ---
function sahteKaynak(satirlar, kind = 'channel') {
  return {
    kind,
    title: kind === 'dm' ? 'ali' : 'genel',
    placeholder: 'yaz…',
    canSend: true,
    other: kind === 'dm' ? ali : undefined,
    canDelete: () => false,
    fetch: async () => satirlar.slice(),
    send: vi.fn(async (metin) => ({ ok: true, message: { id: 99, author_id: 'u1', content: metin, created_at: new Date().toISOString() } })),
    edit: async () => ({ ok: true }),
    remove: async () => {},
    subscribe: () => () => {},
    joinTyping: () => ({ typing() {}, stopped() {}, clear() {}, leave: async () => {} }),
  }
}
const satir = (id, author, content) => ({ id, author_id: author, content, created_at: new Date(Date.UTC(2026, 10, 13, 10, id)).toISOString(), edited_at: null, deleted_at: null })

describe('sohbette @bahsetme', () => {
  let alan
  beforeEach(() => {
    alan = document.createElement('div')
    document.body.appendChild(alan)
  })

  it('kanalda: seni anan mesaj vurgulanır, @ad etiket olur; kendi mesajım vurgulanmaz', async () => {
    const kaynak = sahteKaynak([satir(1, 'u2', 'selam @Berk!'), satir(2, 'u2', 'selam @berkcan'), satir(3, 'u1', '@berk ben')])
    const s = mountChat(alan, { source: kaynak, profile: ben, members: uyeler })
    await bosalt()
    const m = (id) => alan.querySelector(`.message[data-id="${id}"]`)
    expect(m(1).classList.contains('mentioned')).toBe(true)
    expect(m(1).querySelector('.mention').textContent).toBe('@Berk')
    expect(m(2).classList.contains('mentioned')).toBe(false)
    expect(m(3).classList.contains('mentioned')).toBe(false)
    s.destroy()
  })

  it('üyeler sonradan gelince (setMembers) etiketler çizilir', async () => {
    const s = mountChat(alan, { source: sahteKaynak([satir(1, 'u2', 'hey @can')]), profile: ben })
    await bosalt()
    expect(alan.querySelector('.mention')).toBeNull()
    s.setMembers(uyeler)
    expect(alan.querySelector('.mention').textContent).toBe('@can')
    s.destroy()
  })

  it('kanalda öneri listesi var; Enter ile seçince mesaj gönderilmez, sonra Enter gönderir', async () => {
    const kaynak = sahteKaynak([])
    const s = mountChat(alan, { source: kaynak, profile: ben, members: uyeler })
    await bosalt()
    const kutu = alan.querySelector('.composer textarea')
    const liste = alan.querySelector('.composer .mention-suggest')
    expect(liste).not.toBeNull()
    kutu.focus()
    yaz(kutu, '@ca')
    expect(adlar(liste)).toEqual(['can'])
    tus(kutu, 'Enter')
    expect(kutu.value).toBe('@can ')
    expect(kaynak.send).not.toHaveBeenCalled()
    tus(kutu, 'Enter')
    await bosalt()
    expect(kaynak.send).toHaveBeenCalledWith('@can ')
    s.destroy()
  })

  it('DM: öneri listesi yok, etiket ve vurgu yok', async () => {
    const kaynak = sahteKaynak([satir(1, 'u2', '@berk @ali')], 'dm')
    const s = mountChat(alan, { source: kaynak, profile: ben, members: uyeler })
    await bosalt()
    expect(alan.querySelector('.mention-suggest')).toBeNull()
    expect(alan.querySelector('.mention')).toBeNull()
    expect(alan.querySelector('.message.mentioned')).toBeNull()
    s.destroy()
  })
})
