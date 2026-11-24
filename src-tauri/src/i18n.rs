//! Idioma de los textos del backend que llegan a la persona o a un agente: errores de los comandos,
//! el guardián, el consumo, las respuestas de la API de control, el pedido del navegador…
//!
//! El frontend lo fija con `set_locale` al arrancar y cada vez que cambia; al iniciar también se lee
//! de settings.json, para los mensajes de antes de eso. Español por defecto. Las pestañas nuevas lo
//! reciben en ALPHATERM_LANG (para los scripts que corren los agentes).
//!
//! - Texto fijo: `tr("Hola", "Hello", "Olá")` → `&'static str`.
//! - Con formato (siempre devuelve `String`, un `format!` por idioma):
//!   `tr!("No existe {path}", "{path} doesn't exist", "{path} não existe")` o con argumentos después
//!   de `;`: `tr!("Quiere crear {}", "Wants to create {}", "Quer criar {}"; nombre)`.
//! - Con un idioma dado (para tests: no cambiar el global, que otros tests esperan en español):
//!   `Lang::En.pick(es, en, pt)` y `tr_in!(Lang::En; "…", "…", "…"; args)`.
//!
//! No se traducen los logs ni lo que se compara o se parsea en otro lado (etiquetas de las ventanas
//! de consumo, decisiones del registro del guardián, nombres de los perfiles de shell).

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
    /// "es" | "en" | "pt" (sin distinguir mayúsculas); otra cosa: None.
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

    /// Elige la versión de este idioma.
    pub fn pick<T>(self, es: T, en: T, pt: T) -> T {
        match self {
            Lang::Es => es,
            Lang::En => en,
            Lang::Pt => pt,
        }
    }
}

static LANG: AtomicU8 = AtomicU8::new(Lang::Es as u8);

/// Idioma actual.
pub fn lang() -> Lang {
    match LANG.load(Ordering::Relaxed) {
        1 => Lang::En,
        2 => Lang::Pt,
        _ => Lang::Es,
    }
}

/// Cambia el idioma global. Devuelve si cambió.
pub fn set_lang(l: Lang) -> bool {
    LANG.swap(l as u8, Ordering::SeqCst) != l as u8
}

/// Texto fijo en el idioma actual.
pub fn tr(es: &'static str, en: &'static str, pt: &'static str) -> &'static str {
    lang().pick(es, en, pt)
}

/// Idioma guardado en la configuración (clave `language` de settings.json).
pub fn from_settings(v: &Value) -> Option<Lang> {
    v.get("language").and_then(Value::as_str).and_then(Lang::parse)
}

/// El frontend avisa el idioma de la interfaz ("es" | "en" | "pt"; otro valor no cambia nada).
#[tauri::command]
pub fn set_locale(lang: String) {
    if let Some(l) = Lang::parse(&lang) {
        if set_lang(l) {
            // Lo que se leyó de los archivos de consumo se vuelve a armar con los textos nuevos.
            crate::usage::forget_cache();
        }
    }
}

/// `tr!` con el idioma dado (ver el módulo `i18n`).
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

/// Texto con formato en el idioma actual (ver el módulo `i18n`).
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
