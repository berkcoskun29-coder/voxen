// Görüntü için toplam upload bütçesi. Saf fonksiyon: ağa/tarayıcıya dokunmaz.
// Kural: görüntüye toplam upload'ın %60'ı ayrılır (kalan %40 ses ve yedek).
// Bu bütçe izleyiciler arasında eşit bölünür (herkese ayrı akış gönderiyoruz: P2P örgü).
export const VIDEO_SHARE = 0.6
export const LIMITS = {
  screen: { cap: 2500, floor: 300 }, // kbps
  camera: { cap: 1200, floor: 150, capWithScreen: 600 }, // ekran açıkken kamera tavanı 600
}
// Odada (sesli kanalda) biri ekran paylaşıyorsa kameralar küçülür ki upload ekrana kalsın:
// en fazla 500 kbps ve en az yarı çözünürlük (720p -> ≈360p). Spec §2.6.
export const ROOM_SCREEN_CAMERA = { cap: 500, minScale: 2 }
const EN_AZ_KBPS = 30 // 0 verilirse tarayıcı "sınırsız" anlar; asla 0 yazma

// Pay tabanın altına düştüyse çözünürlüğü küçült: önce yarıya (2), çok düşükse dörtte bire (4)
function olcek(pay, taban) {
  if (pay >= taban) return 1
  return pay >= taban / 2 ? 2 : 4
}

const KAPALI = () => ({ maxBitrate: null, scale: 1 }) // null = bu kaynağa dokunma

// uploadMbps: ayarlardaki upload (5/10/20); viewers: görüntü alabilen eş sayısı
// screenMode ('net' | 'akici'): şimdilik bütçeyi değiştirmez (kare hızı/çözünürlük yakalamada belirlenir)
// roomScreenOn: kanalda biri (biz dahil) ekran paylaşıyor -> kamera ROOM_SCREEN_CAMERA kuralına iner
// -> { camera: {maxBitrate (kbps | null), scale}, screen: {...} }
export function computeVideoBudget({ uploadMbps, viewers, cameraOn = false, screenOn = false, screenMode = 'net', roomScreenOn = false }) {
  void screenMode
  const sonuc = { camera: KAPALI(), screen: KAPALI() }
  if (!Number.isFinite(uploadMbps) || !(viewers > 0)) return sonuc // izleyen yok: değişiklik yok
  const pay = (uploadMbps * 1000 * VIDEO_SHARE) / viewers // izleyici başına kbps
  const { screen: E, camera: K } = LIMITS

  let ekran = 0
  let kamera = 0
  if (screenOn && cameraOn) {
    // Ekran öncelikli: kameranın tabanını ayırdıktan sonra kalanı alır (tavana kadar)
    ekran = Math.min(E.cap, Math.max(0, pay - K.floor))
    kamera = Math.min(K.capWithScreen, pay - ekran)
  } else if (screenOn) {
    ekran = Math.min(E.cap, pay)
  } else if (cameraOn) {
    kamera = Math.min(K.cap, pay)
  }
  if (screenOn) sonuc.screen = { maxBitrate: Math.max(EN_AZ_KBPS, Math.round(ekran)), scale: olcek(ekran, E.floor) }
  if (cameraOn) sonuc.camera = { maxBitrate: Math.max(EN_AZ_KBPS, Math.round(kamera)), scale: olcek(kamera, K.floor) }
  if (cameraOn && roomScreenOn) {
    sonuc.camera = {
      maxBitrate: Math.min(sonuc.camera.maxBitrate, ROOM_SCREEN_CAMERA.cap),
      scale: Math.max(sonuc.camera.scale, ROOM_SCREEN_CAMERA.minScale),
    }
  }
  return sonuc
}
