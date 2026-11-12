// Ses seviyesi hesapları (saf fonksiyonlar, tarayıcı gerektirmez).

// Bir ses diliminin RMS (karekök-ortalama-kare) seviyesi: 0 sessizlik, tam genlikli sinüs ≈ 0.707
export function rmsLevel(samples) {
  if (!samples || samples.length === 0) return 0
  let toplam = 0
  for (let i = 0; i < samples.length; i++) toplam += samples[i] * samples[i]
  return Math.sqrt(toplam / samples.length)
}

// Seviye eşiği geçtiyse kişi konuşuyor sayılır
export function isSpeaking(level, threshold = 0.02) {
  return level > threshold
}
