// Görüntü (2. aşama) için WebView2 ayarları:
// 1) İzinler: kamera ve mikrofon yalnız Voxen'in kendi sayfasına otomatik verilir; konum, bildirim vb.
//    diğer her şey reddedilir (otomatik oynatmaya dokunulmaz). Ekran yakalama (getDisplayMedia) bir
//    izin türü DEĞİLDİR: bu olaydan geçmez, WebView2 kendi seçicisini açar. (Bu işleyici olmasaydı
//    WebView2 kamera/mikrofon için her seferinde kendi "izin ver?" kutusunu açardı.)
// 2) Tam ekran: sayfada bir öğe tam ekrana geçince (videodaki ⛶ düğmesi) WebView2 onu yalnız
//    pencerenin içine yayar; biz de pencerenin kendisini tam ekran yaparız, çıkınca geri alırız.
//
// Not: Kullanıcı daha önce bir izni kalıcı olarak verdiyse/reddettiyse WebView2 o kararı kullanır.

use tauri::{Url, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{
    take_pwstr, ContainsFullScreenElementChangedEventHandler, PermissionRequestedEventHandler,
};
use windows_core::{BOOL, PWSTR};

/// İzin isteğine cevabımız. `Varsayilan` = karışma, WebView2 kendi bildiğini yapsın.
#[derive(Debug, PartialEq)]
pub enum Karar {
    Ver,
    Reddet,
    Varsayilan,
}

/// İsteyen adres Voxen'in kendi sayfası mı?
/// Windows'ta program sayfası http://tauri.localhost'tan açılır; geliştirirken Vite'tan (localhost:5173).
pub fn kendi_sayfamiz(adres: &str) -> bool {
    let Ok(url) = Url::parse(adres) else { return false };
    match (url.scheme(), url.host_str(), url.port()) {
        ("http" | "https", Some("tauri.localhost"), None) => true,
        ("tauri", Some("localhost"), None) => true,
        // Geliştirme sunucusu yalnız hata ayıklama derlemesinde kabul edilir
        ("http", Some("localhost"), Some(5173)) => cfg!(debug_assertions),
        _ => false,
    }
}

/// Hangi izne ne cevap verilir (saf fonksiyon: kolay okunsun ve denensin diye ayrı)
pub fn izin_karari(tur: COREWEBVIEW2_PERMISSION_KIND, adres: &str) -> Karar {
    // Otomatik oynatmaya dokunma: sesli sohbette karşı tarafın sesi çalabilsin
    if tur == COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY {
        return Karar::Varsayilan;
    }
    // Ekran yakalama (getDisplayMedia) için WebView2'de izin türü yok; o kendi seçicisini açar.
    let medya = tur == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
        || tur == COREWEBVIEW2_PERMISSION_KIND_CAMERA;
    if medya && kendi_sayfamiz(adres) {
        Karar::Ver
    } else {
        Karar::Reddet
    }
}

/// Ana pencerenin WebView2'sine izin ve tam ekran işleyicilerini bağlar.
pub fn bagla(pencere: &WebviewWindow) -> tauri::Result<()> {
    let pencere_ = pencere.clone();
    pencere.with_webview(move |webview| {
        let sonuc = unsafe { isleyicileri_kur(webview.controller(), pencere_) };
        if let Err(e) = sonuc {
            log::warn!("görüntü işleyicileri kurulamadı: {e}");
        }
    })
}

unsafe fn isleyicileri_kur(
    denetleyici: ICoreWebView2Controller,
    pencere: WebviewWindow,
) -> windows_core::Result<()> {
    let core = denetleyici.CoreWebView2()?;
    // Kayıt jetonları bilerek saklanmaz: işleyiciler pencere ömrü boyunca kalır, hiç kaldırılmaz.
    let mut _izin_jetonu = 0i64;
    let mut _tam_ekran_jetonu = 0i64;

    // 1) İzin istekleri
    core.add_PermissionRequested(
        &PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut tur = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut tur)?;
            let mut adres = PWSTR::null();
            args.Uri(&mut adres)?;
            let adres = take_pwstr(adres);
            let karar = izin_karari(tur, &adres);
            log::info!("izin isteği: tür {} adres {adres} -> {karar:?}", tur.0);
            match karar {
                Karar::Ver => args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?,
                Karar::Reddet => args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?,
                Karar::Varsayilan => {}
            }
            Ok(())
        })),
        &mut _izin_jetonu,
    )?;

    // 2) Öğe tam ekrana girince/çıkınca pencereyi de tam ekran yap/geri al
    core.add_ContainsFullScreenElementChanged(
        &ContainsFullScreenElementChangedEventHandler::create(Box::new(move |sender, _| {
            let Some(sender) = sender else { return Ok(()) };
            let mut tam = BOOL::default();
            sender.ContainsFullScreenElement(&mut tam)?;
            if let Err(e) = pencere.set_fullscreen(tam.as_bool()) {
                log::warn!("tam ekran ayarlanamadı: {e}");
            }
            Ok(())
        })),
        &mut _tam_ekran_jetonu,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kendi_sayfamiz_disinda_kimseye_izin_yok() {
        assert!(kendi_sayfamiz("http://tauri.localhost/index.html"));
        assert!(kendi_sayfamiz("https://tauri.localhost/"));
        assert!(kendi_sayfamiz("tauri://localhost/"));
        assert!(!kendi_sayfamiz("https://ornek.com/"));
        assert!(!kendi_sayfamiz("http://tauri.localhost.kotu.com/"));
        assert!(!kendi_sayfamiz("bozuk adres"));
    }

    #[test]
    fn kamera_mikrofon_verilir_digerleri_reddedilir() {
        let biz = "http://tauri.localhost/";
        assert_eq!(izin_karari(COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, biz), Karar::Ver);
        assert_eq!(izin_karari(COREWEBVIEW2_PERMISSION_KIND_CAMERA, biz), Karar::Ver);
        assert_eq!(izin_karari(COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION, biz), Karar::Reddet);
        assert_eq!(izin_karari(COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS, biz), Karar::Reddet);
        assert_eq!(izin_karari(COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY, biz), Karar::Varsayilan);
        assert_eq!(
            izin_karari(COREWEBVIEW2_PERMISSION_KIND_CAMERA, "https://ornek.com/"),
            Karar::Reddet
        );
    }
}
