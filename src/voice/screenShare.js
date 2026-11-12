// Ekran paylaşımı: ekranı (ve varsa ekran sesini) yakalar. Kameranın (camera.js) ekran karşılığı.

import { PUBLIC_URL } from '../config.js'
import { isTauri } from '../desktop.js'

export const SCREEN_HEADPHONE_WARNING = 'Ekran sesi paylaşırken kulaklık kullan, yoksa arkadaşların kendini duyabilir'

// Kalite seçenekleri: Net = keskin yazı/görüntü, Akıcı = oyun için yüksek kare hızı
export const SCREEN_MODES = {
  net: { width: 1920, height: 1080, frameRate: 30 },
  akici: { width: 1280, height: 720, frameRate: 60 },
}

// Bu tarayıcı/pencere ekran paylaşımını destekliyor mu? (yoksa 🖥 düğmesi gizlenir)
export function screenShareSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

// Masaüstü programında (WebView2) ekran paylaşımı yoksa gösterilecek yazı.
// Web adresi .env'deki VITE_PUBLIC_URL'den gelir, "https://" ve sondaki "/" atılır.
export function desktopScreenNotice(publicUrl = PUBLIC_URL) {
  const adres = (publicUrl ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return adres ? `Bu özellik şimdilik tarayıcı sürümünde: ${adres}` : 'Bu özellik şimdilik tarayıcı sürümünde'
}

// Hata sözleşmesi: code 'cancelled' -> kullanıcı seçiciyi kapattı (sessizce yok sayılır);
// code 'unsupported' -> masaüstü programı ekran yakalamayı desteklemiyor (mesaj: desktopScreenNotice)
export class ScreenShareError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ScreenShareError'
    this.code = code
  }
}

// Ekranı yakalar. { video, audio, stop() } döner; audio yoksa null (sistem sesi paylaşılmadıysa).
// video izine contentHint 'detail': kodlayıcı kare hızından çok keskinliği korur.
export async function startScreenShare({ mode = 'net' } = {}) {
  const ayar = SCREEN_MODES[mode] ?? SCREEN_MODES.net
  let akis
  try {
    akis = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: ayar.width }, height: { ideal: ayar.height }, frameRate: { ideal: ayar.frameRate } },
      // restrictOwnAudio: Voxen'in kendi sesini (arkadaşların sesi) sistem sesi yakalamasından çıkarır
      // (eski tarayıcılar bilinmeyen kısıtı yok sayar).
      // suppressLocalAudioPlayback KULLANMIYORUZ: paylaşılan sekme/oyun paylaşanın kendi hoparlöründe
      // sessize alınıyordu (kendi oyununu duyamıyordu).
      audio: { restrictOwnAudio: true },
      systemAudio: 'include', // 'exclude' seçicideki "sistem sesini paylaş" seçeneğini gizlerdi
    })
  } catch (e) {
    // Seçici kapatıldı ya da izin verilmedi: hata değil, vazgeçme
    if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') throw new ScreenShareError('cancelled', 'iptal')
    // Masaüstünde WebView2 ekran yakalamayı desteklemiyorsa: kullanıcıya web sürümünü söyle
    if (e?.name === 'NotSupportedError' && isTauri()) throw new ScreenShareError('unsupported', desktopScreenNotice())
    throw e
  }
  const video = akis.getVideoTracks()[0]
  const audio = akis.getAudioTracks()[0] ?? null
  if (video) video.contentHint = 'detail'
  return {
    video,
    audio,
    stop() {
      video?.stop()
      audio?.stop()
    },
  }
}
