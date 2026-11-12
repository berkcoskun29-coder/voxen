// Voxen masaüstü programı: web uygulamasını pencerede açar, oyun içi bas-konuş tuşunu dinler,
// tepsi (tray) simgesi ve otomatik güncelleme sağlar.
// Sürüm derlemesinde fazladan konsol penceresi açılmasın (SİLME):
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Kamera/mikrofon/ekran izinleri ve video tam ekranı (WebView2, yalnız Windows)
#[cfg(windows)]
mod goruntu;
mod ptt_hook;

use std::sync::{Arc, Mutex};

use ptt_hook::PttFilter;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

struct PttState(Arc<Mutex<PttFilter>>);

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

// Tepsi simgesi: Aç / Sustur / Çıkış. Sol tıklama pencereyi açar.
fn tepsi_kur(app: &tauri::App) -> tauri::Result<()> {
    let ac = MenuItem::with_id(app, "ac", "Aç", true, None::<&str>)?;
    let sustur = MenuItem::with_id(app, "sustur", "Sustur", true, None::<&str>)?;
    let cikis = MenuItem::with_id(app, "cikis", "Çıkış", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&ac, &sustur, &cikis])?;
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
            "cikis" => app.exit(0),
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
        .manage(PttState(filtre))
        .manage(HookStatus(Mutex::new(None)))
        .manage(BekleyenGuncelleme(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![set_ptt_key, ptt_hook_status, pending_update, install_update])
        .setup(move |app| {
            tepsi_kur(app)?;
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
        // Pencere kapatılınca program kapanmaz, tepsiye iner (Çıkış: tepsi menüsü)
        .on_window_event(|pencere, olay| {
            if let WindowEvent::CloseRequested { api, .. } = olay {
                api.prevent_close();
                let _ = pencere.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Voxen başlatılamadı");
}
