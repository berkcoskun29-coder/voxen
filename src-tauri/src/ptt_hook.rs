// Oyun içi bas-konuş: tüm sistemdeki klavye olaylarını yalnızca DİNLER (Windows WH_KEYBOARD_LL kancası).
// - Tuşu yutmaz, değiştirmez, yeni tuş basmaz: kanca her olaydan sonra CallNextHookEx ile tuşu
//   olduğu gibi sisteme (oyuna) geri verir.
// - Fare kancası kurulmaz; tuş adı hesaplanmaz (ToUnicodeEx / AttachThreadInput YOK), böylece
//   başka programlardaki yazma (ölü tuşlar, AltGr) hiç etkilenmez.
// - Tuş, tarayıcıdaki KeyboardEvent.code gibi FİZİKSEL konumundan (scan code) adlandırılır;
//   klavye düzeni (Türkçe Q/F) fark etmez.
// - Yalnızca seçili tuşun basma/bırakma DEĞİŞİMLERİ web tarafına `ptt-key` olayıyla gönderilir.
// - Bırakma olayı kaybolursa (Win+L, UAC, yönetici olarak çalışan oyun) kapı açık kalmasın diye,
//   tuş basılı sayıldığı sürece 200 ms'de bir gerçek tuş durumuna bakılır.
use serde::Serialize;

/// Bırakma kaybına karşı tuş durumuna bakma aralığı
pub const POLL_MS: u32 = 200;

/// Windows scan code (+ uzatılmış tuş bayrağı) → KeyboardEvent.code.
/// Tablo Chromium'un Windows tablosuyla (dom_code_data.inc) aynıdır.
/// Scan code'u bilinmeyen tuşlarda yalnızca F13–F24 için sanal tuş koduna (VK) bakılır
/// (bazı makro programları bu tuşları scan code'suz gönderir).
pub fn scan_to_code(scan: u32, extended: bool, vk: u32) -> Option<&'static str> {
    let kod = if extended {
        match scan {
            0x1C => Some("NumpadEnter"),
            0x1D => Some("ControlRight"),
            0x35 => Some("NumpadDivide"),
            0x37 => Some("PrintScreen"),
            0x38 => Some("AltRight"),
            0x45 => Some("NumLock"),
            0x47 => Some("Home"),
            0x48 => Some("ArrowUp"),
            0x49 => Some("PageUp"),
            0x4B => Some("ArrowLeft"),
            0x4D => Some("ArrowRight"),
            0x4F => Some("End"),
            0x50 => Some("ArrowDown"),
            0x51 => Some("PageDown"),
            0x52 => Some("Insert"),
            0x53 => Some("Delete"),
            0x5B => Some("MetaLeft"),
            0x5C => Some("MetaRight"),
            0x5D => Some("ContextMenu"),
            _ => None,
        }
    } else {
        temel_tus(scan)
    };
    kod.or_else(|| match vk {
        0x7C..=0x87 => Some(F13_F24[(vk - 0x7C) as usize]),
        _ => None,
    })
}

const F13_F24: [&str; 12] = [
    "F13", "F14", "F15", "F16", "F17", "F18", "F19", "F20", "F21", "F22", "F23", "F24",
];

// Uzatılmış olmayan (E0 öneki olmayan) tuşlar
fn temel_tus(scan: u32) -> Option<&'static str> {
    const TABLO: [Option<&str>; 0x5A] = {
        let mut t: [Option<&str>; 0x5A] = [None; 0x5A];
        t[0x01] = Some("Escape");
        t[0x02] = Some("Digit1");
        t[0x03] = Some("Digit2");
        t[0x04] = Some("Digit3");
        t[0x05] = Some("Digit4");
        t[0x06] = Some("Digit5");
        t[0x07] = Some("Digit6");
        t[0x08] = Some("Digit7");
        t[0x09] = Some("Digit8");
        t[0x0A] = Some("Digit9");
        t[0x0B] = Some("Digit0");
        t[0x0C] = Some("Minus");
        t[0x0D] = Some("Equal");
        t[0x0E] = Some("Backspace");
        t[0x0F] = Some("Tab");
        t[0x10] = Some("KeyQ");
        t[0x11] = Some("KeyW");
        t[0x12] = Some("KeyE");
        t[0x13] = Some("KeyR");
        t[0x14] = Some("KeyT");
        t[0x15] = Some("KeyY");
        t[0x16] = Some("KeyU");
        t[0x17] = Some("KeyI");
        t[0x18] = Some("KeyO");
        t[0x19] = Some("KeyP");
        t[0x1A] = Some("BracketLeft");
        t[0x1B] = Some("BracketRight");
        t[0x1C] = Some("Enter");
        t[0x1D] = Some("ControlLeft");
        t[0x1E] = Some("KeyA");
        t[0x1F] = Some("KeyS");
        t[0x20] = Some("KeyD");
        t[0x21] = Some("KeyF");
        t[0x22] = Some("KeyG");
        t[0x23] = Some("KeyH");
        t[0x24] = Some("KeyJ");
        t[0x25] = Some("KeyK");
        t[0x26] = Some("KeyL");
        t[0x27] = Some("Semicolon");
        t[0x28] = Some("Quote");
        t[0x29] = Some("Backquote");
        t[0x2A] = Some("ShiftLeft");
        t[0x2B] = Some("Backslash");
        t[0x2C] = Some("KeyZ");
        t[0x2D] = Some("KeyX");
        t[0x2E] = Some("KeyC");
        t[0x2F] = Some("KeyV");
        t[0x30] = Some("KeyB");
        t[0x31] = Some("KeyN");
        t[0x32] = Some("KeyM");
        t[0x33] = Some("Comma");
        t[0x34] = Some("Period");
        t[0x35] = Some("Slash");
        t[0x36] = Some("ShiftRight");
        t[0x37] = Some("NumpadMultiply");
        t[0x38] = Some("AltLeft");
        t[0x39] = Some("Space");
        t[0x3A] = Some("CapsLock");
        t[0x3B] = Some("F1");
        t[0x3C] = Some("F2");
        t[0x3D] = Some("F3");
        t[0x3E] = Some("F4");
        t[0x3F] = Some("F5");
        t[0x40] = Some("F6");
        t[0x41] = Some("F7");
        t[0x42] = Some("F8");
        t[0x43] = Some("F9");
        t[0x44] = Some("F10");
        t[0x45] = Some("Pause");
        t[0x46] = Some("ScrollLock");
        t[0x47] = Some("Numpad7");
        t[0x48] = Some("Numpad8");
        t[0x49] = Some("Numpad9");
        t[0x4A] = Some("NumpadSubtract");
        t[0x4B] = Some("Numpad4");
        t[0x4C] = Some("Numpad5");
        t[0x4D] = Some("Numpad6");
        t[0x4E] = Some("NumpadAdd");
        t[0x4F] = Some("Numpad1");
        t[0x50] = Some("Numpad2");
        t[0x51] = Some("Numpad3");
        t[0x52] = Some("Numpad0");
        t[0x53] = Some("NumpadDecimal");
        t[0x56] = Some("IntlBackslash");
        t[0x57] = Some("F11");
        t[0x58] = Some("F12");
        t[0x59] = Some("NumpadEqual");
        t
    };
    match scan {
        0x64..=0x6E => Some(F13_F24[(scan - 0x64) as usize]), // F13–F23
        0x76 => Some("F24"),
        0x70 => Some("KanaMode"),
        0x73 => Some("IntlRo"),
        0x79 => Some("Convert"),
        0x7B => Some("NonConvert"),
        0x7D => Some("IntlYen"),
        0x7E => Some("NumpadComma"),
        s => TABLO.get(s as usize).copied().flatten(),
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PttKeyEvent {
    pub code: String,
    pub down: bool,
}

/// Hangi tuşun izlendiğini ve şu an basılı olup olmadığını tutar.
#[derive(Default)]
pub struct PttFilter {
    selected: Option<String>,
    down: bool,
    vk: u32,            // basılı tuşun sanal tuş kodu (gerçek durumuna bakmak için)
    bos_yoklama: u8,    // art arda kaç yoklamada tuş "bırakılmış" göründü
}

impl PttFilter {
    /// Yeni tuş seçildi (None: tuş yok). Basılı durumu sıfırlanır; web tarafı da kapıyı kapatır.
    pub fn set_key(&mut self, code: Option<String>) {
        self.selected = code.filter(|c| !c.is_empty());
        self.down = false;
        self.bos_yoklama = 0;
    }

    #[cfg(test)]
    pub fn is_down(&self) -> bool {
        self.down
    }

    /// Bir tuş olayı geldi (code: scan_to_code sonucu). Seçili tuşsa ve durumu DEĞİŞTİYSE
    /// gönderilecek olayı döner. Basılı tutunca gelen tekrar "basıldı" olayları atlanır.
    pub fn on_key(&mut self, code: Option<&str>, vk: u32, down: bool) -> Option<PttKeyEvent> {
        let secili = self.selected.as_deref()?;
        if code? != secili {
            return None;
        }
        self.bos_yoklama = 0;
        if down == self.down {
            return None;
        }
        self.down = down;
        self.vk = vk;
        Some(PttKeyEvent { code: secili.to_string(), down })
    }

    /// Bırakma olayı kaybolduysa düzelt: tuş basılı sayılırken gerçekte art arda iki yoklamada
    /// bırakılmış görünüyorsa (tek seferlik zamanlama yanılgısına karşı iki kez) bırakma olayı üretir.
    /// tus_basili_mi(vk): gerçek tuş durumu (Windows'ta GetAsyncKeyState).
    pub fn poll(&mut self, tus_basili_mi: impl Fn(u32) -> bool) -> Option<PttKeyEvent> {
        if !self.down {
            return None;
        }
        if tus_basili_mi(self.vk) {
            self.bos_yoklama = 0;
            return None;
        }
        self.bos_yoklama += 1;
        if self.bos_yoklama < 2 {
            return None;
        }
        self.down = false;
        self.bos_yoklama = 0;
        let code = self.selected.clone()?;
        Some(PttKeyEvent { code, down: false })
    }
}

#[cfg(windows)]
pub use kanca::start;

#[cfg(windows)]
mod kanca {
    use super::{scan_to_code, PttFilter, PttKeyEvent, POLL_MS};
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Arc, Mutex, OnceLock};
    use tauri::{AppHandle, Emitter, Manager};
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetTimer, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION,
        KBDLLHOOKSTRUCT, LLKHF_EXTENDED, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN,
        WM_SYSKEYUP, WM_TIMER,
    };

    struct Baglam {
        filtre: Arc<Mutex<PttFilter>>,
        gonder: Mutex<Sender<PttKeyEvent>>,
    }
    static BAGLAM: OnceLock<Baglam> = OnceLock::new();

    // Kanca geri çağrısı: olabildiğince az iş yapar, asla beklemez, her zaman CallNextHookEx döner.
    unsafe extern "system" fn klavye_kancasi(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && lparam != 0 {
            let basili = match wparam as u32 {
                WM_KEYDOWN | WM_SYSKEYDOWN => Some(true),
                WM_KEYUP | WM_SYSKEYUP => Some(false),
                _ => None,
            };
            if let (Some(basili), Some(b)) = (basili, BAGLAM.get()) {
                let k = &*(lparam as *const KBDLLHOOKSTRUCT);
                let kod = scan_to_code(k.scanCode, k.flags & LLKHF_EXTENDED != 0, k.vkCode);
                // try_lock: kilit o an meşgulse (tuş değiştiriliyor) bu olayı atla, bekleme
                let olay = match b.filtre.try_lock() {
                    Ok(mut f) => f.on_key(kod, k.vkCode, basili),
                    Err(_) => None,
                };
                if let Some(o) = olay {
                    if let Ok(g) = b.gonder.try_lock() {
                        let _ = g.send(o);
                    }
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    fn hata_bildir(app: &AppHandle, mesaj: String) {
        log::error!("{mesaj}");
        if let Some(durum) = app.try_state::<crate::HookStatus>() {
            if let Ok(mut h) = durum.0.lock() {
                *h = Some(mesaj.clone());
            }
        }
        let _ = app.emit("ptt-hook-error", mesaj);
    }

    /// Kancayı kendi iş parçacığında kurar. Olayları web'e ayrı bir iş parçacığı gönderir,
    /// böylece kanca geri çağrısı hiç beklemez. Kurulamazsa ya da iş parçacığı biterse
    /// `ptt-hook-error` olayı gönderilir.
    pub fn start(app: AppHandle, filtre: Arc<Mutex<PttFilter>>) {
        let (gonder, al) = channel::<PttKeyEvent>();
        let yayin_app = app.clone();
        let _ = std::thread::Builder::new()
            .name("ptt-emit".into())
            .spawn(move || {
                for olay in al {
                    let _ = yayin_app.emit("ptt-key", olay);
                }
            });

        let yoklama_filtresi = filtre.clone();
        let yoklama_gonder = gonder.clone();
        if BAGLAM.set(Baglam { filtre, gonder: Mutex::new(gonder) }).is_err() {
            return; // zaten kurulu
        }

        let kanca_app = app.clone();
        let sonuc = std::thread::Builder::new()
            .name("ptt-hook".into())
            .spawn(move || unsafe {
                let kanca = SetWindowsHookExW(
                    WH_KEYBOARD_LL,
                    Some(klavye_kancasi),
                    GetModuleHandleW(std::ptr::null()),
                    0,
                );
                if kanca.is_null() {
                    let hata = std::io::Error::last_os_error();
                    hata_bildir(&kanca_app, format!("ptt hook başlatılamadı: {hata}"));
                    return;
                }
                log::info!("ptt hook thread started");
                // Bırakma kaybına karşı yoklama zamanlayıcısı (bu iş parçacığının kuyruğuna WM_TIMER)
                SetTimer(std::ptr::null_mut(), 0, POLL_MS, None);
                let mut msg: MSG = std::mem::zeroed();
                loop {
                    let r = GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0);
                    if r == 0 || r == -1 {
                        break;
                    }
                    if msg.message == WM_TIMER {
                        let olay = match yoklama_filtresi.lock() {
                            Ok(mut f) => f.poll(|vk| GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0),
                            Err(_) => None,
                        };
                        if let Some(o) = olay {
                            log::info!("bas-konuş tuşunun bırakılması kaçırılmış; kapı kapatıldı");
                            let _ = yoklama_gonder.send(o);
                        }
                    }
                }
                UnhookWindowsHookEx(kanca);
                hata_bildir(&kanca_app, "ptt hook iş parçacığı durdu".into());
            });
        if let Err(e) = sonuc {
            hata_bildir(&app, format!("ptt hook iş parçacığı açılamadı: {e}"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(code: &str, down: bool) -> Option<PttKeyEvent> {
        Some(PttKeyEvent { code: code.into(), down })
    }

    // Kısaltma: uzatılmamış tuş, VK önemsiz
    fn tus(scan: u32) -> Option<&'static str> {
        scan_to_code(scan, false, 0)
    }

    #[test]
    fn harf_ve_f13() {
        assert_eq!(tus(0x2F), Some("KeyV"));
        assert_eq!(tus(0x64), Some("F13"));
        assert_eq!(tus(0x6E), Some("F23"));
        assert_eq!(tus(0x76), Some("F24"));
        // scan code'suz gelen F13–F24: VK'ye bakılır
        assert_eq!(scan_to_code(0, false, 0x7C), Some("F13"));
        assert_eq!(scan_to_code(0, false, 0x87), Some("F24"));
        // diğer tuşlarda VK'ye bakılmaz (düzene bağlıdır)
        assert_eq!(scan_to_code(0, false, 0x56), None);
    }

    #[test]
    fn fiziksel_konum_duzenden_bagimsiz() {
        // Türkçe F'de bu konumdaki harf "Ğ" de olsa code KeyQ'dur (tarayıcı gibi)
        let ornekler = [
            (0x10, "KeyQ"), (0x1E, "KeyA"), (0x2C, "KeyZ"), (0x17, "KeyI"),
            (0x0B, "Digit0"), (0x02, "Digit1"), (0x0A, "Digit9"),
            (0x3B, "F1"), (0x44, "F10"), (0x57, "F11"), (0x58, "F12"),
            (0x39, "Space"), (0x3A, "CapsLock"), (0x0F, "Tab"), (0x29, "Backquote"),
            (0x2A, "ShiftLeft"), (0x36, "ShiftRight"), (0x1D, "ControlLeft"), (0x38, "AltLeft"),
            (0x1A, "BracketLeft"), (0x1B, "BracketRight"), (0x27, "Semicolon"), (0x28, "Quote"),
            (0x2B, "Backslash"), (0x56, "IntlBackslash"), (0x33, "Comma"), (0x34, "Period"),
            (0x35, "Slash"), (0x0C, "Minus"), (0x0D, "Equal"), (0x01, "Escape"),
            (0x46, "ScrollLock"), (0x45, "Pause"),
        ];
        for (scan, kod) in ornekler {
            assert_eq!(tus(scan), Some(kod), "scan {scan:#x}");
        }
        assert_eq!(tus(0x00), None);
        assert_eq!(tus(0x5A), None);
    }

    #[test]
    fn uzatilmis_tuslar() {
        let u = |scan| scan_to_code(scan, true, 0);
        assert_eq!(tus(0x1C), Some("Enter"));
        assert_eq!(u(0x1C), Some("NumpadEnter"));
        assert_eq!(u(0x1D), Some("ControlRight"));
        assert_eq!(u(0x38), Some("AltRight"));
        assert_eq!(tus(0x35), Some("Slash"));
        assert_eq!(u(0x35), Some("NumpadDivide"));
        assert_eq!(u(0x45), Some("NumLock"));
        assert_eq!(u(0x5B), Some("MetaLeft"));
        assert_eq!(u(0x5C), Some("MetaRight"));
        assert_eq!(u(0x5D), Some("ContextMenu"));
        assert_eq!(u(0x37), Some("PrintScreen"));
        // Ok tuşları uzatılmış; aynı scan code uzatılmamışsa sayısal tuş takımıdır
        // (NumLock kapalıyken de: tarayıcı gibi fiziksel tuşu adlandırırız)
        for (scan, ok, numpad) in [
            (0x48, "ArrowUp", "Numpad8"),
            (0x50, "ArrowDown", "Numpad2"),
            (0x4B, "ArrowLeft", "Numpad4"),
            (0x4D, "ArrowRight", "Numpad6"),
            (0x47, "Home", "Numpad7"),
            (0x4F, "End", "Numpad1"),
            (0x49, "PageUp", "Numpad9"),
            (0x51, "PageDown", "Numpad3"),
            (0x52, "Insert", "Numpad0"),
            (0x53, "Delete", "NumpadDecimal"),
        ] {
            assert_eq!(u(scan), Some(ok));
            assert_eq!(tus(scan), Some(numpad));
        }
        assert_eq!(tus(0x37), Some("NumpadMultiply"));
        assert_eq!(tus(0x4A), Some("NumpadSubtract"));
        assert_eq!(tus(0x4E), Some("NumpadAdd"));
        // Sanal "sahte Shift" (E0 2A) bir tuş değildir
        assert_eq!(u(0x2A), None);
    }

    #[test]
    fn yalniz_secili_tus_ve_yalniz_degisimler() {
        let mut f = PttFilter::default();
        assert_eq!(f.on_key(Some("KeyV"), 0x56, true), None); // tuş seçilmedi
        f.set_key(Some("KeyV".into()));
        assert_eq!(f.on_key(Some("KeyB"), 0x42, true), None); // başka tuş
        assert_eq!(f.on_key(None, 0, true), None); // bilinmeyen tuş
        assert_eq!(f.on_key(Some("KeyV"), 0x56, true), ev("KeyV", true));
        assert_eq!(f.on_key(Some("KeyV"), 0x56, true), None); // basılı tutunca gelen tekrarlar atlanır
        assert_eq!(f.on_key(Some("KeyV"), 0x56, false), ev("KeyV", false));
        assert_eq!(f.on_key(Some("KeyV"), 0x56, false), None);
    }

    #[test]
    fn tus_degisince_durum_sifirlanir() {
        let mut f = PttFilter::default();
        f.set_key(Some("KeyV".into()));
        assert_eq!(f.on_key(Some("KeyV"), 0x56, true), ev("KeyV", true));
        f.set_key(Some("F13".into()));
        assert_eq!(f.on_key(Some("KeyV"), 0x56, false), None); // eski tuş artık izlenmiyor
        assert_eq!(f.on_key(Some("F13"), 0x7C, true), ev("F13", true));
        f.set_key(None);
        assert_eq!(f.on_key(Some("F13"), 0x7C, false), None);
    }

    #[test]
    fn birakma_kaybolursa_yoklama_kapatir() {
        use std::cell::Cell;
        let gercek = Cell::new(true); // sahte tuş durumu
        let sorulan = Cell::new(0u32);
        let durum = |vk: u32| {
            sorulan.set(vk);
            gercek.get()
        };
        let mut f = PttFilter::default();
        f.set_key(Some("ControlRight".into()));
        assert_eq!(f.poll(&durum), None); // basılı değilken yoklama bir şey yapmaz
        assert_eq!(f.on_key(Some("ControlRight"), 0xA3, true), ev("ControlRight", true));
        assert_eq!(f.poll(&durum), None); // hâlâ basılı
        assert_eq!(sorulan.get(), 0xA3); // basılan tuşun VK'si soruldu
        gercek.set(false); // bırakma olayı kayboldu (ör. Win+L)
        assert_eq!(f.poll(&durum), None); // tek yoklama yetmez
        assert_eq!(f.poll(&durum), ev("ControlRight", false));
        assert!(!f.is_down());
        assert_eq!(f.poll(&durum), None); // bir kez kapatılır
        // Sonra gerçek bırakma olayı gelirse tekrar gönderilmez
        assert_eq!(f.on_key(Some("ControlRight"), 0xA3, false), None);
    }

    #[test]
    fn yoklamadaki_tek_yanilgi_kapatmaz() {
        use std::cell::Cell;
        let gercek = Cell::new(false);
        let durum = |_vk: u32| gercek.get();
        let mut f = PttFilter::default();
        f.set_key(Some("KeyV".into()));
        f.on_key(Some("KeyV"), 0x56, true);
        assert_eq!(f.poll(&durum), None); // bir kez "bırakılmış" göründü
        gercek.set(true);
        assert_eq!(f.poll(&durum), None); // aslında basılı: sayaç sıfırlandı
        gercek.set(false);
        assert_eq!(f.poll(&durum), None);
        assert!(f.is_down());
    }
}
