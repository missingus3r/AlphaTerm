//! Language of the backend texts that reach a person or an agent: command errors,
//! the Guardian, usage, control API responses, the browser request…
//!
//! The frontend sets it with `set_locale` at startup and every time it changes; at startup it's also read
//! from settings.json, for messages before that. Spanish by default. New tabs
//! receive it in ALPHATERM_LANG (for the scripts that agents run).
//!
//! - Fixed text: `tr("Hola", "Hello", "Olá")` → `&'static str`.
//! - With formatting (always returns `String`, one `format!` per language):
//!   `tr!("No existe {path}", "{path} doesn't exist", "{path} não existe")` or with arguments after
//!   `;`: `tr!("Quiere crear {}", "Wants to create {}", "Quer criar {}"; nombre)`.
//! - With a given language (for tests: don't change the global one, which other tests expect in Spanish):
//!   `Lang::En.pick(es, en, pt)` y `tr_in!(Lang::En; "…", "…", "…"; args)`.
//!
//! Not translated: logs or anything compared or parsed elsewhere (usage window labels,
//! Guardian log decisions, shell profile names).

use serde_json::Value;
use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Lang {
    #[default]
    Es = 0,
    En = 1,
    Pt = 2,
}

impl Lang {
    /// "es" | "en" | "pt" (case-insensitive); anything else: None.
    pub fn parse(s: &str) -> Option<Lang> {
        match s.trim().to_ascii_lowercase().as_str() {
            "es" => Some(Lang::Es),
            "en" => Some(Lang::En),
            "pt" => Some(Lang::Pt),
            _ => None,
        }
    }

    pub fn code(self) -> &'static str {
        self.pick("es", "en", "pt")
    }

    /// Picks this language's version.
    pub fn pick<T>(self, es: T, en: T, pt: T) -> T {
        match self {
            Lang::Es => es,
            Lang::En => en,
            Lang::Pt => pt,
        }
    }
}

static LANG: AtomicU8 = AtomicU8::new(Lang::Es as u8);

/// Current language.
pub fn lang() -> Lang {
    match LANG.load(Ordering::Relaxed) {
        1 => Lang::En,
        2 => Lang::Pt,
        _ => Lang::Es,
    }
}

/// Changes the global language. Returns whether it changed.
pub fn set_lang(l: Lang) -> bool {
    LANG.swap(l as u8, Ordering::SeqCst) != l as u8
}

/// Fixed text in the current language.
pub fn tr(es: &'static str, en: &'static str, pt: &'static str) -> &'static str {
    lang().pick(es, en, pt)
}

/// Language saved in the settings (`language` key of settings.json).
pub fn from_settings(v: &Value) -> Option<Lang> {
    v.get("language").and_then(Value::as_str).and_then(Lang::parse)
}

/// The frontend reports the interface language ("es" | "en" | "pt"; another value changes nothing).
#[tauri::command]
pub fn set_locale(lang: String) {
    if let Some(l) = Lang::parse(&lang) {
        if set_lang(l) {
            // What was read from the usage files is rebuilt with the new texts.
            crate::usage::forget_cache();
        }
    }
}

/// `tr!` with the given language (see the `i18n` module).
#[macro_export]
macro_rules! tr_in {
    ($lang:expr; $es:literal, $en:literal, $pt:literal $(,)?) => {
        match $lang {
            $crate::i18n::Lang::Es => format!($es),
            $crate::i18n::Lang::En => format!($en),
            $crate::i18n::Lang::Pt => format!($pt),
        }
    };
    ($lang:expr; $es:literal, $en:literal, $pt:literal; $($arg:expr),+ $(,)?) => {
        match $lang {
            $crate::i18n::Lang::Es => format!($es, $($arg),+),
            $crate::i18n::Lang::En => format!($en, $($arg),+),
            $crate::i18n::Lang::Pt => format!($pt, $($arg),+),
        }
    };
}

/// Formatted text in the current language (see the `i18n` module).
#[macro_export]
macro_rules! tr {
    ($es:literal, $en:literal, $pt:literal $(,)?) => {
        $crate::tr_in!($crate::i18n::lang(); $es, $en, $pt)
    };
    ($es:literal, $en:literal, $pt:literal; $($arg:expr),+ $(,)?) => {
        $crate::tr_in!($crate::i18n::lang(); $es, $en, $pt; $($arg),+)
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn elige_por_idioma() {
        assert_eq!(Lang::Es.pick("hola", "hello", "olá"), "hola");
        assert_eq!(Lang::En.pick("hola", "hello", "olá"), "hello");
        assert_eq!(Lang::Pt.pick("hola", "hello", "olá"), "olá");
        let n = 3;
        assert_eq!(tr_in!(Lang::En; "{n} pestañas", "{n} tabs", "{n} abas"), "3 tabs");
        assert_eq!(tr_in!(Lang::Pt; "Quiere crear {}", "Wants to create {}", "Quer criar {}"; "a.txt"), "Quer criar a.txt");
        assert_eq!(tr_in!(Lang::Es; "Fijo", "Fixed", "Fixo"), "Fijo");
    }

    #[test]
    fn lee_codigos_y_configuracion() {
        assert_eq!(Lang::parse("EN "), Some(Lang::En));
        assert_eq!(Lang::parse("pt"), Some(Lang::Pt));
        assert_eq!(Lang::parse("fr"), None);
        assert_eq!(Lang::Pt.code(), "pt");
        assert_eq!(from_settings(&json!({ "language": "en" })), Some(Lang::En));
        assert_eq!(from_settings(&json!({ "language": 3 })), None);
        assert_eq!(from_settings(&json!({})), None);
        assert_eq!(Lang::default(), Lang::Es);
    }
}
