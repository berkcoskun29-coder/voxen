// Ayarlar penceresi + bas-konuş tuşu seçme penceresi (ikisi de ortak pencere kalıbını kullanır: modal.js).
// Ayarlar beş bölümdür: Konuşma, Cihazlar, Ses kalitesi, Bildirimler, Hesap.
// Solda bölüm menüsü (sekmeler), sağda o an seçili tek bölüm görünür; son açılan bölüm hatırlanır.
// Her değişiklik hemen kaydedilir (src/settings.js); canlı oturuma uygulamayı app.js yapar.
import { getSettings, updateSettings, onSettingsChange, BITRATE_MIN, BITRATE_MAX, UPLOAD_SECENEKLERI } from '../settings.js'
import { keyLabel } from '../voice/ptt.js'
import { isTauri } from '../desktop.js'
import { openMicTest } from './micTest.js'
import { createModalShell } from './modal.js'
import { avatarTextColor } from './avatarColor.js'
import { getNotifySettings, setNotifySettings, requestNotifyPermission } from '../notify.js'

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

let ayarPenceresi = null // aynı anda en fazla bir ayarlar penceresi (açıksa ortak kalıbın döndürdüğü nesne)
let tusPenceresi = null // aynı anda en fazla bir tuş seçme penceresi

// "Bas-konuş tuşunu seç" penceresi.
// Ortadaki kutu "Dinliyorum… bir tuşa bas" der ve hafifçe nabız atar (hareket azaltma tercihinde durur).
// Basılan tuşun adı kutuda görünür; başka tuşa basınca seçim değişir. Kaydetmek için onay gerekir:
// "Kaydet" düğmesi ya da (bir tuş seçildikten sonra) Enter. İlk basılan Enter ise tuş olarak seçilir.
// Esc, Vazgeç, X ya da arka plan tıklaması yalnız BU pencereyi kapatır ve vazgeçme sayılır (onDone(null)).
// Pencere açıkken ptt tuşları yok sayılır (setSuspended), yoksa seçerken kapı açılırdı.
export function askPttKey(ptt, onDone) {
  if (tusPenceresi?.isConnected) return tusPenceresi // zaten açık
  let secilen = null // basılan tuşun kodu; hiç basılmadıysa null
  let onaylandi = false // Kaydet/Enter ile onaylandı mı; değilse kapanış vazgeçme sayılır
  // Enter seçimi onaylar; ama ilk basılan tuş Enter ise tuş olarak seçilir (bunu da söyleriz)
  const ipucu = el('p', 'muted', "Kullanmak istediğin tuşa bas. Vazgeçmek için Esc. Enter'ı seçmek istiyorsan ilk tuş olarak Enter'a bas.")
  // Tuş kutusu: ekran okuyucu seçilen tuşun adını da okusun (aria-live)
  const kutu = el('div', 'key-listen dinliyor', 'Dinliyorum… bir tuşa bas')
  kutu.setAttribute('aria-live', 'polite')
  const kabuk = createModalShell({
    baslik: 'Bas-konuş tuşu', // başlık kısa, açıklama altında
    govde: [ipucu, kutu],
    birincil: { yazi: 'Kaydet', tik: () => { onaylandi = true; return null } },
    // Pencere hangi yolla kapanırsa kapansın (Kaydet, Enter, Esc, Vazgeç, X, arka plan) buradan geçer
    onKapat: () => {
      window.removeEventListener('keydown', basinca, true)
      tusPenceresi = null
      ptt?.setSuspended(false)
      const sonuc = onaylandi ? secilen : null
      if (sonuc) { updateSettings({ pttKey: sonuc }); ptt?.setKey(sonuc) }
      onDone?.(sonuc)
    },
  })
  kabuk.anaDugme.disabled = true // tuş seçilmeden onaylanamaz
  ptt?.setSuspended(true)

  function basinca(e) {
    // Bu tuşu biz aldık: ne sayfadaki başka dinleyiciler ne de alttaki pencere (ör. Ayarlar) görsün.
    // preventDefault, ortak kalıbın Esc dinleyicisine "bu tuş işlendi" der.
    e.preventDefault()
    e.stopPropagation()
    if (e.repeat) return
    if (e.code === 'Escape') { kabuk.kapat(); return } // Esc yalnız vazgeçer
    if (secilen && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
      onaylandi = true // tuş seçiliyken Enter onaydır
      kabuk.kapat()
      return
    }
    // Yeni seçim: kutuda tuşun adı görünür, nabız durur, Kaydet açılır
    secilen = e.code
    kutu.textContent = keyLabel(secilen)
    kutu.classList.remove('dinliyor')
    ipucu.textContent = "Kaydetmek için Enter'a ya da Kaydet'e bas. Değiştirmek için başka bir tuşa bas."
    kabuk.anaDugme.disabled = false
  }
  window.addEventListener('keydown', basinca, true) // yakalama aşamasında: başkası görmeden alırız
  tusPenceresi = kabuk.arka
  return kabuk.arka
}

// Bas-konuş modundayız ve tuş seçilmemişse pencereyi aç (ilk katılışta / ayarlar açılırken)
export function askPttKeyIfNeeded(ptt, onDone) {
  const s = getSettings()
  if (s.mode !== 'ptt' || s.pttKey) return null
  return askPttKey(ptt, onDone)
}

// Ayar alanı: etiket kutunun üstünde, kontrol ortada, açıklama altında küçük gri yazıyla.
// kontrol: input/select/düğme ya da birkaç öğeyi tutan bir satır. aciklama boşsa yazılmaz.
let alanSayac = 0
function alan(etiket, kontrol, aciklama = '') {
  const kutu = el('div', 'field')
  const lbl = el('label', '', etiket)
  // Etikete tıklayınca kontrol seçilsin: label'ı id ile bağlarız
  const hedef = kontrol.matches('input, select, button') ? kontrol : kontrol.querySelector('input, select, button')
  if (hedef) {
    if (!hedef.id) hedef.id = `ayar-alan-${++alanSayac}`
    lbl.htmlFor = hedef.id
  }
  kutu.append(lbl, kontrol)
  if (aciklama) kutu.appendChild(el('p', 'hint', aciklama))
  return kutu
}

// Bölüm başlığı + o bölümün alanları
function bolum(baslik, ...alanlar) {
  const kutu = el('section', 'settings-section')
  kutu.append(el('h3', 'settings-section-title', baslik), ...alanlar)
  return kutu
}

// Son açılan bölüm tarayıcıda hatırlanır. Depolama kapalıysa (gizli pencere vb.) sessizce geçeriz.
const BOLUM_ANAHTARI = 'voxen.ayarlarBolum'
function sonBolumuOku() {
  try { return localStorage.getItem(BOLUM_ANAHTARI) } catch { return null }
}
function sonBolumuYaz(ad) {
  try { localStorage.setItem(BOLUM_ANAHTARI, ad) } catch { /* hatırlanmazsa sorun değil */ }
}

// Solda menü, sağda tek bölüm. bolumler: [{ ad, baslik, kutu, acilinca? }] (kutu: bolum() ile kurulan section;
// acilinca: bölüm her gösterildiğinde çağrılır)
// Menü bir sekme listesidir (role="tablist"): yalnız seçili sekme Tab sırasındadır,
// sekmeler arasında ok tuşlarıyla gezilir (aşağı/sağ sonraki, yukarı/sol önceki, başa/sona sarar),
// Home ilk, End son sekmeye gider. Bölümler yeniden kurulmaz, yalnız gizlenir: ayarlar yerinde kalır.
function sekmeliDuzen(bolumler) {
  const duzen = el('div', 'settings-layout')
  const menu = el('div', 'settings-nav')
  menu.setAttribute('role', 'tablist')
  menu.setAttribute('aria-label', 'Ayar bölümleri')
  // aria-orientation yok: dar pencerede sekmeler yatay dizilir, ok tuşları iki yönde de çalışır
  const sag = el('div', 'settings-panels')

  const sekmeler = bolumler.map(({ ad, baslik, kutu }) => {
    const sekme = el('button', '', baslik)
    sekme.type = 'button'
    sekme.id = `ayar-sekme-${ad}`
    sekme.setAttribute('role', 'tab')
    sekme.setAttribute('aria-controls', `ayar-bolum-${ad}`)
    kutu.id = `ayar-bolum-${ad}`
    kutu.setAttribute('role', 'tabpanel')
    kutu.setAttribute('aria-labelledby', sekme.id)
    sekme.onclick = () => sec(ad)
    menu.appendChild(sekme)
    sag.appendChild(kutu)
    return sekme
  })

  // ad: gösterilecek bölüm. odakla: true ise sekmeye odak da verilir (ok tuşlarıyla gezerken)
  function sec(ad, odakla = false) {
    bolumler.forEach((b, i) => {
      const secili = b.ad === ad
      sekmeler[i].setAttribute('aria-selected', String(secili))
      sekmeler[i].tabIndex = secili ? 0 : -1
      b.kutu.hidden = !secili
      if (secili && odakla) sekmeler[i].focus()
      if (secili) b.acilinca?.()
    })
    sonBolumuYaz(ad)
  }

  menu.addEventListener('keydown', (e) => {
    const simdiki = sekmeler.indexOf(document.activeElement)
    if (simdiki < 0) return
    const n = sekmeler.length
    let yeni
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') yeni = (simdiki + 1) % n
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') yeni = (simdiki - 1 + n) % n
    else if (e.key === 'Home') yeni = 0
    else if (e.key === 'End') yeni = n - 1
    else return
    e.preventDefault() // sayfa/pencere kaymasın
    sec(bolumler[yeni].ad, true)
  })

  // Açılışta: hatırlanan bölüm (geçerliyse), yoksa ilki
  const hatirlanan = sonBolumuOku()
  sec(bolumler.some((b) => b.ad === hatirlanan) ? hatirlanan : bolumler[0].ad)

  duzen.append(menu, sag)
  return duzen
}

async function cihazlariDoldur(girisSec, cikisSec, kameraSec, s) {
  try {
    const liste = await navigator.mediaDevices.enumerateDevices()
    for (const [tur, sec, secili, ad] of [
      ['audioinput', girisSec, s.inputDeviceId, 'Mikrofon'],
      ['audiooutput', cikisSec, s.outputDeviceId, 'Hoparlör'],
      ['videoinput', kameraSec, s.cameraDeviceId, 'Kamera'],
    ]) {
      let n = 0
      for (const d of liste.filter((x) => x.kind === tur)) {
        n++
        const o = el('option', '', d.label || `${ad} ${n}`) // izin verilmeden etiket boş gelir
        o.value = d.deviceId
        sec.appendChild(o)
      }
      sec.value = secili ?? ''
      if (sec.value !== (secili ?? '')) sec.value = '' // cihaz artık takılı değil
    }
  } catch { /* cihaz listesi alınamadı: sadece "Varsayılan" kalır */ }
}

// ptt: PttController. onProfile: profil penceresini açar.
// onSignOut: "Çıkış yap" düğmesi. app.js'teki çıkış işleyicisinin kendisi verilir
// (önce varlık/ses temizliği, sonra signOut); burada yeniden yazılmaz.
// account: { profile, email } hesap kartı için (verilmezse kartta yalnız "Profili düzenle" düğmesi olur).
// notify: { mutedServers() -> [{ id, name }], onUnmute(serverId) -> Promise } Bildirimler bölümündeki
// "Sessize alınan sunucular" listesi için (sessize alma hesapta saklanır; işi app.js yapar).
export function openSettings({ ptt, onProfile, onSignOut, account, notify } = {}) {
  if (ayarPenceresi?.arka.isConnected) return { close: () => ayarPenceresi?.kapat() } // zaten açık
  const s = getSettings()

  // ---- Konuşma ----
  // Mod
  const mod = document.createElement('select')
  mod.dataset.ayar = 'mod'
  for (const [v, y] of [['ptt', 'Bas-konuş'], ['vad', 'Sesle algılama']]) {
    const o = el('option', '', y)
    o.value = v
    mod.appendChild(o)
  }
  mod.value = s.mode

  // Tuş (yalnız ptt modunda): seçili tuş + "Değiştir" düğmesi
  const tusYazi = el('kbd', 'key-chip')
  const tusBtn = el('button', 'secondary small', 'Değiştir')
  tusBtn.type = 'button'
  const tusKutusu = el('div', 'key-row')
  tusKutusu.append(tusYazi, tusBtn)
  const tusSatiri = alan('Bas-konuş tuşu', tusKutusu, 'Oyunda kullandığın bas-konuş tuşundan farklı bir tuş seç.')
  // Masaüstünde: oyun yönetici olarak çalışıyorsa Windows, yönetici olmayan programın tuşu görmesine izin vermez
  if (isTauri()) tusSatiri.appendChild(el('p', 'hint', "Oyun yönetici olarak çalışıyorsa ve tuş algılanmıyorsa Voxen'i de yönetici olarak çalıştır."))
  const tusGoster = () => { tusYazi.textContent = keyLabel(getSettings().pttKey) || 'seçilmedi' }
  tusBtn.onclick = () => askPttKey(ptt, tusGoster)

  // Sesle algılama hassasiyeti (yalnız vad modunda)
  const vad = document.createElement('input')
  vad.type = 'range'; vad.dataset.ayar = 'vad'
  vad.min = '0.005'; vad.max = '0.1'; vad.step = '0.005'; vad.value = String(s.vadThreshold)
  const vadSatiri = alan('Sesle algılama eşiği', vad, 'Sola çektikçe daha kısık sesler de iletilir.')
  vadSatiri.dataset.ayar = 'vad-satiri'
  vad.oninput = () => updateSettings({ vadThreshold: Number(vad.value) })

  function modGoster() {
    const m = getSettings().mode
    tusSatiri.hidden = m !== 'ptt'
    vadSatiri.hidden = m !== 'vad'
  }
  mod.onchange = () => { updateSettings({ mode: mod.value }); modGoster(); askPttKeyIfNeeded(ptt, tusGoster) }

  // ---- Cihazlar ----
  const giris = document.createElement('select')
  const cikis = document.createElement('select')
  const kamera = document.createElement('select')
  kamera.dataset.ayar = 'kamera'
  for (const sec of [giris, cikis, kamera]) {
    const o = el('option', '', 'Varsayılan')
    o.value = ''
    sec.appendChild(o)
  }
  giris.onchange = () => updateSettings({ inputDeviceId: giris.value || null })
  cikis.onchange = () => updateSettings({ outputDeviceId: cikis.value || null })
  kamera.onchange = () => updateSettings({ cameraDeviceId: kamera.value || null }) // açıksa app.js canlı geçirir
  const sinkVar = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
  if (!sinkVar) cikis.disabled = true // bu tarayıcı çıkış cihazı seçtirmiyor
  cihazlariDoldur(giris, cikis, kamera, s)

  // Mikrofon testi (ayarların üstünde açılır; kapanınca ayarlara dönülür)
  const testBtn = el('button', 'secondary', 'Mikrofon testi')
  testBtn.type = 'button'
  testBtn.onclick = () => openMicTest()

  // ---- Ses kalitesi ----
  // Gürültü engelleme: onay kutusu solda, yazısı sağında
  const ns = document.createElement('input')
  ns.type = 'checkbox'; ns.id = 'ayar-ns'; ns.checked = s.noiseSuppression
  ns.onchange = () => updateSettings({ noiseSuppression: ns.checked })
  const nsSatiri = el('div', 'check-row')
  const nsEtiket = el('label', '', 'Gürültü engelleme')
  nsEtiket.htmlFor = 'ayar-ns'
  nsSatiri.append(ns, nsEtiket)
  // Aynı ayar mikrofon testi penceresinde de var: orada değişirse buradaki kutu da değişsin
  const nsDinlemeyiBirak = onSettingsChange((yeni) => { ns.checked = yeni.noiseSuppression })

  // Ses kalitesi: 32–128 kbps, 8'er adım; değeri kaydırıcının sağında yazar
  const kalite = document.createElement('input')
  kalite.type = 'range'; kalite.dataset.ayar = 'bitrate'
  kalite.min = String(BITRATE_MIN); kalite.max = String(BITRATE_MAX); kalite.step = '8'
  kalite.value = String(s.bitrateKbps)
  const kaliteYazi = el('span', 'muted', `${s.bitrateKbps} kbps`)
  kalite.oninput = () => {
    const yeni = updateSettings({ bitrateKbps: Number(kalite.value) }) // sınır dışı olamaz
    kaliteYazi.textContent = `${yeni.bitrateKbps} kbps`
  }
  const kaliteKutusu = el('div', 'range-row')
  kaliteKutusu.append(kalite, kaliteYazi)

  // Görüntü için toplam yükleme (upload) hızı (5/10/20 Mbps)
  const upload = document.createElement('select')
  upload.dataset.ayar = 'upload'
  for (const mbps of UPLOAD_SECENEKLERI) {
    const o = el('option', '', `${mbps} Mbps`)
    o.value = String(mbps)
    upload.appendChild(o)
  }
  upload.value = String(s.uploadMbps)
  upload.onchange = () => updateSettings({ uploadMbps: Number(upload.value) })

  // Ekran paylaşımı kalitesi: bir sonraki paylaşımda geçerli
  const ekranKalite = document.createElement('select')
  ekranKalite.dataset.ayar = 'ekran-kalite'
  for (const [deger, yazi] of [['net', 'Net (1080p, 30 fps)'], ['akici', 'Akıcı (720p, 60 fps)']]) {
    const o = el('option', '', yazi)
    o.value = deger
    ekranKalite.appendChild(o)
  }
  ekranKalite.value = s.screenMode
  ekranKalite.onchange = () => updateSettings({ screenMode: ekranKalite.value })

  // ---- Bildirimler ----
  // İki açma kapama düğmesi (cihazda saklanır, src/notify.js) ve sessize alınan sunucular (hesapta saklanır)
  const onayKutusu = (id, yazi, deger, degisince) => {
    const kutu = document.createElement('input')
    kutu.type = 'checkbox'; kutu.id = id; kutu.checked = deger
    kutu.onchange = () => degisince(kutu.checked)
    const satir = el('div', 'check-row')
    const etiket = el('label', '', yazi)
    etiket.htmlFor = id
    satir.append(kutu, etiket)
    return satir
  }
  const bs = getNotifySettings()
  const masaustuSatiri = onayKutusu('ayar-bildirim', 'Masaüstü bildirimleri', bs.masaustu, (acik) => {
    setNotifySettings({ masaustu: acik })
    if (acik) requestNotifyPermission({ acik: true }) // tarayıcıda izin daha önce sorulmadıysa şimdi sorulur
  })
  const sesSatiri = onayKutusu('ayar-bildirim-ses', 'Bildirim sesi', bs.ses, (acik) => setNotifySettings({ ses: acik }))

  const sessizBaslik = el('span', 'group-label', 'Sessize alınan sunucular')
  const sessizListe = el('ul', 'muted-servers')
  function sessizleriCiz() {
    sessizListe.replaceChildren()
    const liste = notify?.mutedServers?.() ?? []
    if (liste.length === 0) {
      sessizListe.appendChild(el('li', 'muted-servers-empty', 'Sessize alınan sunucu yok.'))
      return
    }
    for (const sunucu of liste) {
      const satir = el('li', 'muted-server-row')
      const ad = el('span', 'muted-server-name', sunucu.name) // kullanıcı yazısı: textContent
      ad.title = sunucu.name
      const ac = el('button', 'secondary small', 'Sesi aç')
      ac.type = 'button'
      ac.setAttribute('aria-label', `${sunucu.name} sesini aç`)
      ac.onclick = async () => {
        ac.disabled = true
        try { await notify?.onUnmute?.(sunucu.id) } catch { ac.disabled = false; return } // hata metnini app.js gösterir
        sessizleriCiz()
      }
      satir.append(ad, ac)
      sessizListe.appendChild(satir)
    }
  }
  sessizleriCiz()

  // ---- Hesap ----
  // Profil: ayarları kapatıp profil penceresini açar
  const profilBtn = el('button', 'secondary', 'Profili düzenle')
  profilBtn.type = 'button'
  profilBtn.onclick = () => { kabuk.kapat(); onProfile?.() }
  // Çıkış yap: sakin ikincil düğme (kırmızı çerçeve + yazı, zemin yok). Önce onay sorar;
  // onaylanınca ayarları kapatır ve app.js'teki çıkış işleyicisini aynen çağırır.
  const cikisBtn = el('button', 'danger-outline', 'Çıkış yap')
  cikisBtn.type = 'button'
  cikisBtn.onclick = () => {
    const onay = createModalShell({
      baslik: 'Çıkış yapılsın mı?',
      govde: [el('p', 'muted', 'Sesli kanaldaysan bağlantın da kapanır.')],
      birincil: {
        yazi: 'Çıkış yap',
        tik: () => {
          onay.kapat() // önce onay, sonra ayarlar kapanır (odak sırayla geri döner)
          kabuk.kapat()
          onSignOut?.()
          return null
        },
      },
      tehlikeli: true, // onaydaki "Çıkış yap" kırmızı
    })
  }
  // Hesap kartı: avatar, kullanıcı adı, soluk e-posta, sağda "Profili düzenle"
  const hesapKarti = el('div', 'account-card')
  if (account?.profile) {
    const p = account.profile
    const av = el('span', 'account-avatar')
    av.style.background = p.color
    av.style.color = avatarTextColor(p.color)
    if (p.avatar_url) {
      const img = document.createElement('img')
      img.src = p.avatar_url
      img.alt = ''
      av.appendChild(img)
    } else {
      av.textContent = (Array.from(p.username)[0] ?? '?').toLocaleUpperCase('tr')
    }
    const bilgi = el('div', 'account-info')
    const ad = el('div', 'account-name', p.username)
    ad.title = p.username // uzun ad "…" ile kısalır, tam ad burada
    bilgi.appendChild(ad)
    if (account.email) {
      const eposta = el('div', 'account-email', account.email)
      eposta.title = account.email
      bilgi.appendChild(eposta)
    }
    hesapKarti.append(av, bilgi, profilBtn)
  } else {
    hesapKarti.appendChild(profilBtn)
  }
  // "Çıkış yap" kartın altında, ince çizgiyle ayrılmış kendi satırında
  const cikisSatiri = el('div', 'account-signout')
  cikisSatiri.appendChild(cikisBtn)
  const hesapSatiri = el('div', 'account-row')
  hesapSatiri.append(hesapKarti, cikisSatiri)

  const kabuk = createModalShell({
    baslik: 'Ayarlar',
    genis: true,
    ikincil: 'Kapat', // her değişiklik anında kaydedilir; ayrıca "Kaydet" düğmesine gerek yok
    odakBasliga: true, // açılınca ilk kutuya değil başlığa odaklan (halka bir alanda çıkmasın)
    govde: [sekmeliDuzen([
      { ad: 'konusma', baslik: 'Konuşma', kutu: bolum('Konuşma',
        alan('Mod', mod),
        tusSatiri,
        vadSatiri,
      ) },
      { ad: 'cihazlar', baslik: 'Cihazlar', kutu: bolum('Cihazlar',
        alan('Mikrofon', giris, 'Değişiklik bir sonraki sesli kanala katılışta geçerli olur.'),
        alan('Hoparlör', cikis, sinkVar ? '' : 'Bu tarayıcı hoparlör seçmeyi desteklemiyor.'),
        alan('Kamera', kamera),
        testBtn,
      ) },
      { ad: 'kalite', baslik: 'Ses kalitesi', kutu: bolum('Ses kalitesi',
        nsSatiri,
        alan('Ses kalitesi', kaliteKutusu),
        alan('Yükleme hızın', upload, 'Ekran paylaşımı ve kamera bu hızın bir kısmını kullanır'),
        alan('Ekran paylaşımı', ekranKalite, 'Bir sonraki paylaşımda geçerli olur.'),
      ) },
      { ad: 'bildirimler', baslik: 'Bildirimler', kutu: bolum('Bildirimler',
        masaustuSatiri,
        sesSatiri,
        sessizBaslik,
        sessizListe,
      ), acilinca: () => { sessizleriCiz(); requestNotifyPermission({ acik: true }) } },
      { ad: 'hesap', baslik: 'Hesap', kutu: bolum('Hesap', hesapSatiri) },
    ])],
    onKapat: () => {
      ayarPenceresi = null // tek pencere kuralı: kapanınca yenisi açılabilir
      nsDinlemeyiBirak()
    },
  })
  kabuk.kart.classList.add('settings-card') // iki kolonlu, geniş ve sabit yükseklikli pencere
  ayarPenceresi = kabuk

  tusGoster()
  modGoster()
  askPttKeyIfNeeded(ptt, tusGoster) // ayarlar açılırken tuş yoksa hemen sor
  return { close: () => kabuk.kapat() }
}
