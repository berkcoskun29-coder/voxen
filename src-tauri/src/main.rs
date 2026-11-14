// Voxen masaüstü programı: web uygulamasını pencerede açar, oyun içi bas-konuş tuşunu dinler,
// tepsi (tray) simgesi, kapatınca tepsiye küçültme, Windows açılışında başlatma ve otomatik güncelleme sağlar.
// Sürüm derlemesinde fazladan konsol penceresi açılmasın (SİLME):
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Kamera/mikrofon/ekran izinleri ve video tam ekranı (WebView2, yalnız Windows)
#[cfg(windows)]
mod goruntu;
mod ptt_hook;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use ptt_hook::PttFilter;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

struct PttState(Arc<Mutex<PttFilter>>);

/// Windows açılışında başlatılınca verilen argüman: pencere gösterilmez, program tepside başlar
const GIZLI_ARGUMAN: &str = "--gizli";

/// Güncelleme kurulmadan önce uygulama veri klasörüne yazılan işaret dosyası. Güncelleyici programı eski
/// argümanlarla (autostart ile açıldıysa "--gizli" dahil) yeniden başlatır; bu dosya varsa pencere yine gösterilir.
const GUNCELLEME_ISARETI: &str = "guncelleme-sonrasi-goster";

/// Açılışta pencere gösterilsin mi? "--gizli" yoksa evet; varsa yalnız güncelleme işareti bulunursa
/// (işaret okununca silinir). Saf karar: `gizli_arguman`, `isaret_vardi`.
fn acilista_goster(gizli_arguman: bool, isaret_vardi: bool) -> bool {
    !gizli_arguman || isaret_vardi
}

/// İşaret dosyası varsa siler ve true döner
fn guncelleme_isaretini_al(app: &AppHandle) -> bool {
    let Ok(klasor) = app.path().app_data_dir() else { return false };
    let yol = klasor.join(GUNCELLEME_ISARETI);
    if yol.exists() {
        let _ = std::fs::remove_file(&yol);
        true
    } else {
        false
    }
}

/// Çıkış başladı mı (iki kez başlamasın)
struct Cikiyor(AtomicBool);

/// Programdan düzgün çıkış (tepsiden "Çıkış" ya da ayar kapalıyken pencereyi kapatmak):
/// önce web'e `app-quitting` gönderilir; web sesli kanaldan/aramadan ayrılır (bye + voice_states silme) ve
/// `quit_now` çağırır. Web cevap vermezse (giriş ekranı, donma) 2 sn sonra yine çıkılır.
fn cikis_baslat(app: &AppHandle) {
    if app.state::<Cikiyor>().0.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    let _ = app.emit("app-quitting", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        app.exit(0);
    });
}

/// Web temizliği bitirdi: hemen çık
#[tauri::command]
fn quit_now(app: AppHandle) {
    app.exit(0);
}

/// Klavye kancası kurulamadıysa ya da durduysa hata mesajı (web açılınca sorabilsin diye saklanır)
pub struct HookStatus(pub Mutex<Option<String>>);

/// Kanca hatası varsa mesajı, yoksa null döner. (Hata ayrıca `ptt-hook-error` olayıyla da gönderilir.)
#[tauri::command]
fn ptt_hook_status(state: tauri::State<'_, HookStatus>) -> Option<String> {
    state.0.lock().ok().and_then(|h| h.clone())
}

/// Web tarafı bas-konuş tuşunu değiştirince çağırır. null = tuş yok (hiçbir olay gönderilmez).
#[tauri::command]
fn set_ptt_key(code: Option<String>, state: tauri::State<'_, PttState>) {
    log::info!("bas-konuş tuşu: {:?}", code);
    if let Ok(mut f) = state.0.lock() {
        f.set_key(code);
    }
}

fn pencereyi_goster(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Pencereyi kapatınca tepsiye mi küçülsün (true, varsayılan) yoksa program mı kapansın (false).
/// Ayar web tarafında (Ayarlar > Bildirimler "Kapatınca tepsiye küçült"); açılışta ve değişince bildirilir.
struct TepsiyeKucult(AtomicBool);

/// Web tarafı "Kapatınca tepsiye küçült" ayarını bildirir.
#[tauri::command]
fn set_close_to_tray(acik: bool, state: tauri::State<'_, TepsiyeKucult>) {
    state.0.store(acik, Ordering::Relaxed);
}

/// Tepsi menüsündeki "Rahatsız etmeyin" işaretli öğesi (web durumu değişince eşitlenir)
struct TepsiDnd(CheckMenuItem<tauri::Wry>);

/// Web tarafı kendi "Rahatsız etmeyin" durumunu bildirir; tepsideki işaret buna uyar.
#[tauri::command]
fn set_tray_dnd(acik: bool, state: tauri::State<'_, TepsiDnd>) {
    let _ = state.0.set_checked(acik);
}

// Tepsi simgesi: Voxen'i aç / Sustur / Rahatsız etmeyin / Çıkış. Sol tıklama pencereyi açar.
// "Rahatsız etmeyin"i web uygulaması uygular (durum orada tutulur) ve işareti set_tray_dnd ile eşitler.
fn tepsi_kur(app: &tauri::App) -> tauri::Result<()> {
    let ac = MenuItem::with_id(app, "ac", "Voxen'i aç", true, None::<&str>)?;
    let sustur = MenuItem::with_id(app, "sustur", "Sustur", true, None::<&str>)?;
    let dnd = CheckMenuItem::with_id(app, "dnd", "Rahatsız etmeyin", true, false, None::<&str>)?;
    let cikis = MenuItem::with_id(app, "cikis", "Çıkış", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&ac, &sustur, &dnd, &cikis])?;
    app.manage(TepsiDnd(dnd.clone()));
    let mut tepsi = TrayIconBuilder::with_id("voxen")
        .tooltip("Voxen")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, olay| match olay.id.as_ref() {
            "ac" => pencereyi_goster(app),
            // Susturmayı web uygulaması yapar (sesli kanalda değilse bir şey olmaz)
            "sustur" => {
                let _ = app.emit("tray-toggle-mute", ());
            }
            // Durumu web uygulaması değiştirir (src/ui/app.js), sonra işareti set_tray_dnd ile eşitler
            "dnd" => {
                // Windows işareti tıklamayla kendisi çevirir: geri al. Asıl değeri yalnız web yazar
                // (set_tray_dnd); web dinlemiyorsa (giriş ekranı) işaret durumdan kaymaz.
                if let Some(d) = app.try_state::<TepsiDnd>() {
                    if let Ok(isaretli) = d.0.is_checked() {
                        let _ = d.0.set_checked(!isaretli);
                    }
                }
                let _ = app.emit("tray-toggle-dnd", ());
            }
            "cikis" => cikis_baslat(app),
            _ => {}
        })
        .on_tray_icon_event(|tepsi, olay| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = olay
            {
                pencereyi_goster(tepsi.app_handle());
            }
        });
    if let Some(simge) = app.default_window_icon() {
        tepsi = tepsi.icon(simge.clone());
    }
    tepsi.build(app)?;
    Ok(())
}

/// Bulunan ama henüz kurulmamış güncellemenin sürümü (web açılınca `pending_update` ile sorar)
pub struct BekleyenGuncelleme(pub Mutex<Option<String>>);

/// Web tarafı açılınca bekleyen güncelleme var mı diye sorar.
#[tauri::command]
fn pending_update(state: tauri::State<'_, BekleyenGuncelleme>) -> Option<String> {
    state.0.lock().ok().and_then(|g| g.clone())
}

/// Kullanıcı bandta "Güncelle"ye basınca: indirir, kurar, yeniden başlatır.
/// (Otomatik kurulum yok; sesli kanalda olup olmadığını web tarafı denetler.)
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let guncelleme = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Güncelleme bulunamadı".to_string())?;
    // Yeniden açılışta pencere görünsün ("--gizli" ile açılmış olsa da): işaret dosyası
    if let Ok(klasor) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&klasor);
        let _ = std::fs::write(klasor.join(GUNCELLEME_ISARETI), b"1");
    }
    guncelleme
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

// Açılışta ve her 6 saatte bir güncelleme var mı bakar; varsa sadece web uygulamasına haber verir
// (`update-available` olayı, yük: sürüm). İndirme/kurulum kullanıcı onayıyla `install_update` ile olur.
// Ulaşılamıyorsa sessizce geçer; program çökmez.
fn guncelleme_denetle(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_updater::UpdaterExt;
        loop {
            let sonuc = async {
                match app.updater()?.check().await? {
                    Some(g) => {
                        log::info!("güncelleme bulundu: {}", g.version);
                        if let Ok(mut b) = app.state::<BekleyenGuncelleme>().0.lock() {
                            *b = Some(g.version.clone());
                        }
                        let _ = app.emit("update-available", g.version.clone());
                    }
                    None => log::info!("güncelleme yok"),
                }
                Ok::<(), tauri_plugin_updater::Error>(())
            }
            .await;
            if let Err(e) = sonuc {
                log::warn!("güncelleme denetlenemedi: {e}");
            }
            bekle(6 * 60 * 60).await;
        }
    });
}

async fn bekle(saniye: u64) {
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_secs(saniye))
    })
    .await
    .ok();
}

fn main() {
    let filtre = Arc::new(Mutex::new(PttFilter::default()));
    let hook_filtresi = filtre.clone();
    tauri::Builder::default()
        // Tek örnek: Voxen ikinci kez açılırsa yeni pencere açılmaz, var olan öne gelir
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            pencereyi_goster(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Mesaj linkleri varsayılan tarayıcıda açılır (src/ui/links.js); izin yalnız http/https adreslerine
        .plugin(tauri_plugin_opener::init())
        // DM ve @bahsetme bildirimleri (src/notify.js); tıklanınca web tarafı pencereyi öne getirir ve konuşmayı açar
        .plugin(tauri_plugin_notification::init())
        // Windows açılışında başlat (isteğe bağlı, varsayılan kapalı). Böyle açılınca "--gizli" ile tepside başlar.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![GIZLI_ARGUMAN]),
        ))
        .manage(PttState(filtre))
        .manage(TepsiyeKucult(AtomicBool::new(true)))
        .manage(Cikiyor(AtomicBool::new(false)))
        .manage(HookStatus(Mutex::new(None)))
        .manage(BekleyenGuncelleme(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            set_ptt_key,
            ptt_hook_status,
            pending_update,
            install_update,
            set_close_to_tray,
            set_tray_dnd,
            quit_now
        ])
        .setup(move |app| {
            tepsi_kur(app)?;
            // Pencere gizli oluşturulur (tauri.conf.json "visible": false); Windows açılışında başlatıldıysa
            // ("--gizli") tepside kalır, yoksa hemen gösterilir.
            let gizli = std::env::args().any(|a| a == GIZLI_ARGUMAN);
            let isaret = guncelleme_isaretini_al(app.handle());
            if acilista_goster(gizli, isaret) {
                pencereyi_goster(app.handle());
            }
            #[cfg(windows)]
            if let Some(pencere) = app.get_webview_window("main") {
                // İsteğe bağlı özellik: kurulamazsa program yine açılır, yalnız log'a yazılır
                if let Err(e) = goruntu::bagla(&pencere) {
                    log::warn!("görüntü işleyicileri bağlanamadı: {e}");
                }
            }
            ptt_hook::start(app.handle().clone(), hook_filtresi.clone());
            guncelleme_denetle(app.handle().clone());
            Ok(())
        })
        // Pencere kapatılınca (ayar açıksa, varsayılan) program kapanmaz, tepsiye iner; bildirimler ve sesli
        // kanal sürer (Çıkış: tepsi menüsü). Web `hidden-to-tray` olayıyla ilk seferde bir kez bilgi verir.
        // Ayar kapalıysa program kapanır.
        .on_window_event(|pencere, olay| {
            if let WindowEvent::CloseRequested { api, .. } = olay {
                let app = pencere.app_handle();
                if app.state::<TepsiyeKucult>().0.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = pencere.hide();
                    let _ = app.emit("hidden-to-tray", ());
                } else {
                    // Ayar kapalı: program kapanır, ama önce web sesli kanaldan düzgün ayrılır
                    api.prevent_close();
                    cikis_baslat(app);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Voxen başlatılamadı");
}

#[cfg(test)]
mod testler {
    use super::acilista_goster;

    #[test]
    fn gizli_acilis_ve_guncelleme_isareti() {
        assert!(acilista_goster(false, false)); // normal açılış
        assert!(!acilista_goster(true, false)); // Windows açılışı: tepside
        assert!(acilista_goster(true, true)); // güncellemeden sonra: "--gizli" olsa da görünür
        assert!(acilista_goster(false, true));
    }
}
