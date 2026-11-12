// Mesaj düzenleme/silme parçaları: üzerine gelince çıkan simgeler, yerinde düzenleme kutusu,
// silme onay penceresi. Bu dosya yalnız DOM kurar; veri işlerini chatView.js yapar.
import { createModalShell } from './modal.js'
import { MAX_UZUNLUK } from '../data/messages.js'

const tamZaman = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Mesajın sağ üstündeki simgeler. Gizli durumu CSS'te opacity ile yapılır (display/visibility değil),
// böylece klavyeyle Tab'a girer ve odaklanınca (focus-within) görünür.
// izin: { duzenle: bool, sil: bool }, tik: { onEdit(), onDelete(shiftBasili) }
export function eylemCubugu(izin, tik) {
  if (!izin.duzenle && !izin.sil) return null
  const cubuk = document.createElement('div')
  cubuk.className = 'msg-actions'
  const dugme = (sinif, simge, yazi, eylem, fn) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `msg-action ${sinif}`
    b.dataset.act = eylem
    b.dataset.tip = yazi
    b.setAttribute('aria-label', yazi)
    b.textContent = simge
    b.onclick = (e) => fn(e)
    return b
  }
  if (izin.duzenle) cubuk.appendChild(dugme('msg-action-duzenle', '✏️', 'Düzenle', 'duzenle', () => tik.onEdit()))
  if (izin.sil) cubuk.appendChild(dugme('msg-action-sil', '🗑️', 'Sil', 'sil', (e) => tik.onDelete(e.shiftKey)))
  return cubuk
}

// "(düzenlendi)" yazısı; üzerine gelince düzenlenme zamanı (data-tip, tooltip.js gösterir)
export function duzenlendiEtiketi(editedAt) {
  const s = document.createElement('span')
  s.className = 'msg-edited'
  s.textContent = '(düzenlendi)'
  s.dataset.tip = `Düzenlendi: ${tamZaman.format(new Date(editedAt))}`
  return s
}

// Yerinde düzenleme kutusu. Aynı öğe, liste yeniden çizilince de kullanılır (yazılan kaybolmasın).
// kaydet(metin) ve vazgec() chatView'dan gelir. Dönen: { el, kutu, uyar(metin) }
export function duzenlemeKutusu(ilkMetin, { kaydet, vazgec }) {
  const el = document.createElement('div')
  el.className = 'msg-edit'
  const kutu = document.createElement('textarea')
  kutu.className = 'msg-edit-input'
  kutu.rows = 1
  kutu.value = ilkMetin
  kutu.setAttribute('aria-label', 'Mesajı düzenle')
  const uyari = document.createElement('div')
  uyari.className = 'msg-edit-warning'
  const ipucu = document.createElement('div')
  ipucu.className = 'msg-edit-hint'
  ipucu.textContent = 'Esc ile vazgeç · Enter ile kaydet'
  el.append(kutu, uyari, ipucu)

  const boyutla = () => { kutu.style.height = 'auto'; if (kutu.scrollHeight) kutu.style.height = kutu.scrollHeight + 'px' }
  kutu.addEventListener('input', () => {
    boyutla()
    uyari.textContent = kutu.value.trim().length > MAX_UZUNLUK ? 'Mesaj en fazla 2000 karakter olabilir' : ''
  })
  kutu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); vazgec() }
    else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); kaydet(kutu.value) }
  })
  return { el, kutu, boyutla, uyar(metin) { uyari.textContent = metin ?? '' } }
}

// Silme onayı: "Mesaj silinsin mi?", kısa önizleme, Vazgeç / Sil (kırmızı).
// sil() hata metni döndürürse pencere açık kalır ve metin gösterilir (modal.js kalıbı).
export function silmeOnayi(mesaj, yazarAdi, sil, onKapat = null) {
  const onizleme = document.createElement('div')
  onizleme.className = 'msg-delete-preview'
  const ad = document.createElement('strong')
  ad.textContent = yazarAdi
  const kisa = Array.from(mesaj.content)
  const metin = document.createElement('div')
  metin.textContent = kisa.length > 120 ? kisa.slice(0, 120).join('') + '…' : mesaj.content
  onizleme.append(ad, metin)
  return createModalShell({
    baslik: 'Mesaj silinsin mi?',
    govde: [onizleme],
    birincil: { yazi: 'Sil', tik: sil },
    tehlikeli: true,
    onKapat,
  })
}
