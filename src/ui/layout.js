// Ana düzen: solda sunucu şeridi (72px), kanal paneli (240px), esnek ana alan, sağda üye paneli (240px).

// root'un içine üç bölümü kurar ve düğümleri döner.
export function mountLayout(root) {
  root.innerHTML = ''
  const rail = document.createElement('nav')
  rail.className = 'server-rail'
  const channels = document.createElement('aside')
  channels.className = 'channel-panel'
  const main = document.createElement('main')
  main.className = 'main-area'
  const members = document.createElement('aside')
  members.className = 'member-panel'
  root.append(rail, channels, main, members)
  return { rail, channels, main, members }
}

// Ekranın altında kısa süre görünen mesaj
export function toast(mesaj) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = mesaj
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

// Küçük pencere: başlık, alanlar, Vazgeç/Oluştur düğmeleri.
// alanlar: HTMLElement dizisi. onSubmit() hata metni dönerse pencere açık kalır, null dönerse kapanır.
export function openModal(baslik, alanlar, onSubmit, kaydetYazisi = 'Oluştur') {
  const arka = document.createElement('div')
  arka.className = 'modal-back'
  const kart = document.createElement('div')
  kart.className = 'card'
  const h = document.createElement('h1')
  h.textContent = baslik
  const hata = document.createElement('p')
  hata.className = 'error'
  const dugmeler = document.createElement('div')
  dugmeler.className = 'buttons'
  const iptal = document.createElement('button')
  iptal.type = 'button'; iptal.className = 'secondary'; iptal.textContent = 'Vazgeç'
  const kaydet = document.createElement('button')
  kaydet.type = 'button'; kaydet.textContent = kaydetYazisi
  dugmeler.append(iptal, kaydet)
  kart.append(h, ...alanlar, hata, dugmeler)
  arka.appendChild(kart)
  document.body.appendChild(arka)

  iptal.onclick = () => arka.remove()
  kaydet.onclick = async () => {
    hata.textContent = ''
    const sonuc = await onSubmit()
    if (sonuc) hata.textContent = sonuc
    else arka.remove()
  }
  return arka
}
