// Küçük baloncuk: data-tip özniteliği olan öğenin üstüne gelince ya da klavyeyle odaklanınca görünür.
// Tek bir baloncuk öğesi vardır ve sayfanın üstünde (position: fixed) durur; böylece kaydırılan
// şeridin içinde kesilmez. data-tip-side="right" ise öğenin sağında, "bottom" ise altında
// (ekranın tepesindeki düğmeler için), yoksa üstünde çıkar.
// Sistemin kendi title baloncuğu aynı yazıyı ikinci kez göstermesin diye, baloncuk açıkken title geçici alınır.

let balon = null
let hedef = null
let eskiTitle = null
let tekrarZamani = null // tıklamadan sonra yeniden göstermek için bekleyen zamanlayıcı
let fareUstunde = false // fare şu an bir data-tip öğesinin üstünde mi

function kapat() {
  clearTimeout(tekrarZamani)
  tekrarZamani = null
  if (hedef && eskiTitle !== null) hedef.title = eskiTitle
  hedef = null
  eskiTitle = null
  if (balon) balon.hidden = true
}

function ac(el) {
  if (hedef === el && hedef.isConnected) return
  kapat()
  hedef = el
  if (el.hasAttribute('title')) { eskiTitle = el.title; el.removeAttribute('title') }
  balon.textContent = el.dataset.tip
  balon.hidden = false
  const r = el.getBoundingClientRect()
  if (el.dataset.tipSide === 'right') {
    balon.style.left = r.right + 10 + 'px'
    balon.style.top = r.top + r.height / 2 + 'px'
    balon.dataset.side = 'right'
  } else if (el.dataset.tipSide === 'bottom') {
    balon.style.left = r.left + r.width / 2 + 'px'
    balon.style.top = r.bottom + 8 + 'px'
    balon.dataset.side = 'bottom'
  } else {
    balon.style.left = r.left + r.width / 2 + 'px'
    balon.style.top = r.top - 8 + 'px'
    balon.dataset.side = 'top'
  }
}

// Bir kez çağrılır (main.js). Olaylar belgede dinlenir: şerit yeniden çizilse de çalışır.
export function installTooltips() {
  if (balon) return
  balon = document.createElement('div')
  balon.className = 'tooltip'
  balon.setAttribute('role', 'tooltip')
  balon.hidden = true
  document.body.appendChild(balon)
  const bul = (e) => (e.target instanceof Element ? e.target.closest('[data-tip]') : null)
  // Öğe yeniden çizilip DOM'dan kalkarsa mouseout gelmez: bir sonraki olayda takılı baloncuğu kapat
  const gelen = (e) => {
    const el = bul(e)
    if (hedef && !hedef.isConnected) kapat()
    if (el) ac(el)
    else kapat()
  }
  document.addEventListener('mouseover', (e) => { fareUstunde = !!bul(e); gelen(e) })
  // Odakla gelen baloncuk yalnız klavye odağında (Tab) açılır; fareyle tıklayınca gelen odakta açılmaz
  // (fare zaten üstündeyse mouseover gösterir). Tarayıcı :focus-visible bilmiyorsa hep gösteririz.
  const klavyeOdagi = (el) => {
    try { return el.matches(':focus-visible') } catch { return true }
  }
  document.addEventListener('focusin', (e) => {
    if (e.target instanceof Element && !klavyeOdagi(e.target)) return
    gelen(e)
  })
  document.addEventListener('mouseout', (e) => {
    const el = bul(e)
    // Aynı düğmenin içindeki simgeler arasında gezerken titreme olmasın
    if (el && e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return
    if (el) { fareUstunde = false; kapat() }
  })
  document.addEventListener('focusout', (e) => { if (bul(e)) kapat() })
  // Tıklama açık/kapa düğmesinin (aria-pressed) adını değiştirir (Mikrofonu kapat -> aç) ve paneli
  // yeniden çizebilir: kısa süre sonra aynı yerdeki düğmenin yeni adını göster.
  // Diğer düğmelerde (Ayarlar, Ekran...) açılan pencerenin üstünde baloncuk kalmasın diye gösterme.
  // Zamanlayıcı kapat() ile iptal olur; fare ayrıldıysa da gösterilmez.
  document.addEventListener('click', (e) => {
    const el = bul(e)
    const x = e.clientX, y = e.clientY
    kapat()
    if (!el || !el.hasAttribute('aria-pressed')) return
    tekrarZamani = setTimeout(() => {
      tekrarZamani = null
      const yeni = el.isConnected ? el : document.elementFromPoint?.(x, y)?.closest?.('[data-tip]')
      // Fare hâlâ üstündeyse ya da düğme klavyeyle odaktaysa göster
      if (yeni && yeni.hasAttribute('aria-pressed') && (fareUstunde || document.activeElement === yeni)) ac(yeni)
    }, 50)
  })
}
