// Kamera: görüntü izini açar. Mikrofonun (pipeline.js openMic) kamera karşılığı.

// Hata sözleşmesi: openCamera her zaman `code` alanı olan bir CameraError fırlatır.
//   code 'denied' -> izin verilmedi, code 'no-camera' -> kamera yok
export class CameraError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CameraError'
    this.code = code
  }
}

// Arayüzde gösterilecek Türkçe metinler
export const CAMERA_MESSAGES = {
  denied: 'Kamera izni verilmedi',
  'no-camera': 'Kamera bulunamadı',
}

// Kamerayı 1280x720 / 30 fps açar ve görüntü iznini döner.
// contentHint 'motion': kodlayıcı kare hızını çözünürlüğe tercih eder.
export async function openCamera(deviceId) {
  const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
  if (deviceId) video.deviceId = { exact: deviceId }
  try {
    const akis = await navigator.mediaDevices.getUserMedia({ video })
    const iz = akis.getVideoTracks()[0]
    iz.contentHint = 'motion'
    return iz
  } catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') throw new CameraError('denied', CAMERA_MESSAGES.denied)
    if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') throw new CameraError('no-camera', CAMERA_MESSAGES['no-camera'])
    throw e
  }
}
