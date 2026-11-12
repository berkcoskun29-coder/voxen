// Avatar baş harfi rengi (T05): palet için sabit eşleme, bilinmeyen renk için parlaklık hesabı.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/lib/supabase.js', () => ({ supabase: {} })) // auth.js yalnız paleti için içe aktarılıyor
const { AVATAR_COLORS } = await import('../src/auth/auth.js')
const { avatarTextColor, contrastRatio, AVATAR_TEXT_COLORS } = await import('../src/ui/avatarColor.js')

describe('avatarTextColor', () => {
  it('paletteki her renk için sabit bir eşleme var ve kontrast en az 4.5:1', () => {
    for (const renk of AVATAR_COLORS) {
      expect(AVATAR_TEXT_COLORS[renk], renk).toBeTruthy()
      expect(avatarTextColor(renk)).toBe(AVATAR_TEXT_COLORS[renk])
      expect(contrastRatio(renk, avatarTextColor(renk)), renk).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('açık yeşilde koyu harf (#0f1a14), harf rengi büyük/küçük harfe bakmaz', () => {
    expect(avatarTextColor('#3be37a')).toBe('#0f1a14')
    expect(avatarTextColor('#3BE37A')).toBe('#0f1a14')
  })
  it('bilinmeyen (eski profil) renklerde parlaklıkla karar verir', () => {
    expect(avatarTextColor('#ffffff')).toBe('#0f1a14')
    expect(avatarTextColor('#fff')).toBe('#0f1a14')
    expect(avatarTextColor('#111111')).toBe('#ffffff')
    expect(avatarTextColor('#8d93a1')).toBe('#0f1a14')
    expect(avatarTextColor('#1a237e')).toBe('#ffffff')
  })
  it('bilinmeyen renkte seçilen harf rengi iki seçenekten daha iyi kontrastlı olandır', () => {
    for (const renk of ['#7a3b3b', '#c0c0c0', '#336699', '#cc6600', '#00aa88']) {
      const sec = avatarTextColor(renk)
      const diger = sec === '#ffffff' ? '#0f1a14' : '#ffffff'
      expect(contrastRatio(renk, sec)).toBeGreaterThanOrEqual(contrastRatio(renk, diger))
    }
  })
  it('okunamayan renk değerinde beyaza düşer (çökmez)', () => {
    expect(avatarTextColor(undefined)).toBe('#ffffff')
    expect(avatarTextColor('kırmızı')).toBe('#ffffff')
  })
})
