// Güncelleme bandı: "Yeni sürüm hazır (vX.Y.Z) — Güncelle / Sonra".
// Sesli kanaldayken asla gösterilmez ve kurulum başlatılmaz; kanaldan çıkınca refresh() ile görünür.
export const updateBannerText = (version) => `Yeni sürüm hazır (v${version})`

export function createUpdateBanner({ isInVoice, onInstall, onError = () => {}, doc = document }) {
  let version = null
  let dismissed = false
  let installing = false
  let el = null

  function remove() { el?.remove(); el = null }

  function render() {
    if (!version || dismissed || isInVoice()) return remove()
    if (el) return
    el = doc.createElement('div')
    el.className = 'update-banner'
    const yazi = doc.createElement('span')
    yazi.textContent = `${updateBannerText(version)} — `
    const guncelle = doc.createElement('button')
    guncelle.dataset.act = 'install'
    guncelle.textContent = 'Güncelle'
    guncelle.onclick = () => install()
    const sonra = doc.createElement('button')
    sonra.dataset.act = 'later'
    sonra.className = 'icon-btn'
    sonra.textContent = 'Sonra'
    sonra.onclick = () => { dismissed = true; render() }
    el.append(yazi, guncelle, sonra)
    doc.body.appendChild(el)
  }

  async function install() {
    if (isInVoice() || installing || !version) return
    installing = true
    const dugme = el?.querySelector('[data-act="install"]')
    if (dugme) { dugme.disabled = true; dugme.textContent = 'İndiriliyor…' }
    try {
      await onInstall()
    } catch (e) {
      installing = false
      if (dugme) { dugme.disabled = false; dugme.textContent = 'Güncelle' }
      onError(e)
    }
  }

  return {
    offer(v) {
      if (v === version && dismissed) return // aynı sürüm için "Sonra" denmişti: tekrar gösterme
      version = v; dismissed = false; render()
    },
    refresh: render,
    install,
    dispose() { version = null; remove() },
  }
}
