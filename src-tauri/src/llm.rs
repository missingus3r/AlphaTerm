//! Resumen de pestaña con un modelo (opcional): un endpoint compatible con OpenAI (Ollama, vLLM,
//! LM Studio…). Recibe las últimas líneas de la terminal y devuelve un título de pocas palabras.

use serde_json::{json, Value};
use std::time::Duration;

/// Instrucciones para el modelo, en el idioma de la interfaz (el título sale en ese idioma).
fn system_prompt() -> &'static str {
    crate::i18n::tr(
        "Resumís lo que pasa en una terminal en un título de pestaña de 2 a 6 palabras, en español. \
Solo el título: sin comillas, sin punto final, sin explicar. Si es un agente de IA trabajando, decí en qué tarea.",
        "You summarize what is happening in a terminal as a tab title of 2 to 6 words, in English. \
Only the title: no quotes, no final period, no explanation. If it is an AI agent working, say on which task.",
        "Você resume o que acontece em um terminal em um título de aba de 2 a 6 palavras, em português do Brasil. \
Só o título: sem aspas, sem ponto final, sem explicar. Se for um agente de IA trabalhando, diga em qual tarefa.",
    )
}

/// Limpia lo que devuelve el modelo: primera línea, sin comillas ni etiquetas de "pensamiento".
pub fn clean_title(raw: &str) -> Option<String> {
    let mut s = raw.to_string();
    while let (Some(a), Some(b)) = (s.find("<think>"), s.find("</think>")) {
        if b < a {
            break;
        }
        s.replace_range(a..b + "</think>".len(), "");
    }
    let line = s.lines().map(str::trim).find(|l| !l.is_empty())?;
    let t = line
        .trim_start_matches(|c: char| c == '#' || c == '*' || c == '-' || c.is_whitespace())
        .trim_start_matches("Título:")
        .trim_start_matches("Title:")
        .trim();
    // Comillas, asteriscos y punto final pueden venir en cualquier orden: se sacan hasta que no quede nada.
    let mut t = t.to_string();
    loop {
        let n = t.trim().trim_matches(|c| c == '"' || c == '\'' || c == '`' || c == '*' || c == '«' || c == '»' || c == '.').trim().to_string();
        if n == t {
            break;
        }
        t = n;
    }
    if t.is_empty() {
        return None;
    }
    Some(t.chars().take(60).collect())
}

#[tauri::command]
pub async fn llm_summarize(endpoint: String, model: String, api_key: Option<String>, text: String) -> Result<String, String> {
    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(crate::i18n::tr("El endpoint tiene que empezar con http:// o https://", "The endpoint must start with http:// or https://", "O endpoint precisa começar com http:// ou https://").into());
    }
    let tail: String = {
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
        let start = lines.len().saturating_sub(60);
        lines[start..].join("\n").chars().rev().take(6000).collect::<Vec<_>>().into_iter().rev().collect()
    };
    let client = reqwest::Client::builder().timeout(Duration::from_secs(45)).build().map_err(|e| e.to_string())?;
    let mut req = client.post(&url).json(&json!({
        "model": model,
        "messages": [ { "role": "system", "content": system_prompt() }, { "role": "user", "content": tail } ],
        "max_tokens": 24,
        "temperature": 0.2,
        "stream": false
    }));
    if let Some(k) = api_key.filter(|k| !k.trim().is_empty()) {
        req = req.bearer_auth(k.trim());
    }
    let resp = req.send().await.map_err(|e| tr!("No se pudo hablar con {url}: {e}", "Couldn't reach {url}: {e}", "Não foi possível falar com {url}: {e}"))?;
    let status = resp.status();
    let v: Value = resp.json().await.map_err(|e| tr!("Respuesta inválida ({status}): {e}", "Invalid response ({status}): {e}", "Resposta inválida ({status}): {e}"))?;
    if !status.is_success() {
        return Err(v.pointer("/error/message").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("HTTP {status}")));
    }
    let content = v.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or("");
    clean_title(content).ok_or_else(|| crate::i18n::tr("El modelo no devolvió un título", "The model didn't return a title", "O modelo não retornou um título").into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limpia_el_titulo() {
        assert_eq!(clean_title("\"Arreglando tests de login\".").as_deref(), Some("Arreglando tests de login"));
        assert_eq!(clean_title("<think>a ver...</think>\n\nTítulo: Build de Rust").as_deref(), Some("Build de Rust"));
        assert_eq!(clean_title("**npm run dev en web**\nexplicación").as_deref(), Some("npm run dev en web"));
        assert_eq!(clean_title("   \n "), None);
    }
}
