// Sabitlenmiş mesajlar penceresi (başlıktaki 📌 düğmesi açar). Ortak pencere kalıbı: modal.js.
// Her satır: yazar, kısa metin, sabitlenme tarihi. Satıra tıklayınca pencere kapanır ve mesaja gidilir.
// Yetkiliye her satırda "Sabitlemeyi kaldır" düğmesi. Kullanıcı yazısı hep textContent ile.
import { createModalShell } from './modal.js'
import { toast } from './layout.js'

const tarihBicimi = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Metnin ilk n karakteri (emoji gibi çift kod birimli karakterler bölünmez), uzunsa "…"
export function kisalt(metin, n) {
  const k = Array.from(String(metin ?? ''))
  return k.length > n ? k.slice(0, n).join('') + '…' : k.join('')
}

// yukle(): Promise<mesaj[]> (fetchPinned). adBul(authorId): yazar adı (yoksa 'Bilinmeyen').
// yetkili(mesaj): "Sabitlemeyi kaldır" gösterilsin mi. kaldir(id): Promise (hata fırlatırsa toast).
// git(id): mesaja git (pencere önce kapanır). profilleriYukle(mesajlar): eksik yazar adlarını getirir.
export function sabitListesiAc({ yukle, adBul, yetkili, kaldir, git, profilleriYukle = async () => {} }) {
  const liste = document.createElement('ul')
  liste.className = 'pin-list'
  liste.setAttribute('aria-label', 'Sabitlenmiş mesajlar')
  const durum = document.createElement('p')
  durum.className = 'pin-list-status'
  durum.setAttribute('role', 'status')
  durum.textContent = 'Yükleniyor…'

  const pencere = createModalShell({ baslik: 'Sabitlenmiş mesajlar', govde: [durum, liste], ikincil: 'Kapat' })

  function bosMu() {
    if (!liste.children.length) durum.textContent = 'Henüz sabitlenmiş mesaj yok.'
  }

  function satirKur(m) {
    const li = document.createElement('li')
    li.className = 'pin-item'
    li.dataset.id = String(m.id)
    const git_ = document.createElement('button')
    git_.type = 'button'
    git_.className = 'pin-item-go'
    const ust = document.createElement('span')
    ust.className = 'pin-item-head'
    const ad = document.createElement('strong')
    ad.textContent = adBul(m.author_id)
    const zaman = document.createElement('span')
    zaman.className = 'pin-item-date'
    // Liste sabitlenme sırasıyla dizili: tarih de sabitlenme tarihi (yoksa mesajın tarihi)
    const sabitlenme = new Date(m.pinned_at ?? NaN)
    zaman.textContent = tarihBicimi.format(Number.isNaN(sabitlenme.getTime()) ? new Date(m.created_at) : sabitlenme)
    zaman.dataset.tip = 'Sabitlenme tarihi'
    ust.append(ad, zaman)
    const metin = document.createElement('span')
    metin.className = 'pin-item-text'
    metin.textContent = kisalt(m.content, 120)
    git_.append(ust, metin)
    git_.setAttribute('aria-label', `${ad.textContent}: ${metin.textContent} — mesaja git`)
    git_.onclick = () => { pencere.kapat(); git(m.id) }
    li.appendChild(git_)
    if (yetkili(m)) {
      const kaldir_ = document.createElement('button')
      kaldir_.type = 'button'
      kaldir_.className = 'secondary pin-item-unpin'
      kaldir_.textContent = 'Sabitlemeyi kaldır'
      kaldir_.onclick = async () => {
        kaldir_.disabled = true
        try {
          await kaldir(m.id)
          li.remove()
          bosMu()
          liste.querySelector('button')?.focus()
        } catch (e) {
          kaldir_.disabled = false
          toast(e?.message || 'Sabitleme kaldırılamadı. Tekrar dene.', 'hata')
        }
      }
      li.appendChild(kaldir_)
    }
    return li
  }

  ;(async () => {
    try {
      const mesajlar = await yukle()
      await profilleriYukle(mesajlar)
      if (!pencere.arka.isConnected) return
      durum.textContent = ''
      for (const m of mesajlar) liste.appendChild(satirKur(m))
      bosMu()
    } catch {
      if (pencere.arka.isConnected) durum.textContent = 'Sabitlenmiş mesajlar yüklenemedi.'
    }
  })()

  return pencere
}
