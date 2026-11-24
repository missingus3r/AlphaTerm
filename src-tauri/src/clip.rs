//! Pegar imágenes en la terminal: si el portapapeles trae una imagen y no texto (una captura con
//! Win+Shift+S, por ejemplo), se guarda como PNG en `%TEMP%\AlphaTerm\pegadas` y se pega su ruta.
//! Claude Code y Codex reconocen la ruta de una imagen pegada y la adjuntan; cualquier otro
//! programa recibe la ruta. Las capturas quedan en la carpeta temporal (Windows la limpia).

use std::path::{Path, PathBuf};
use tauri_plugin_clipboard_manager::ClipboardExt;

pub fn write_png(path: &Path, width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
    if rgba.len() != (width as usize) * (height as usize) * 4 {
        return Err(crate::i18n::tr("La imagen del portapapeles vino incompleta.", "The clipboard image was incomplete.", "A imagem da área de transferência veio incompleta.").into());
    }
    let f = std::fs::File::create(path).map_err(|e| tr!("No se pudo crear {}: {e}", "Couldn't create {}: {e}", "Não foi possível criar {}: {e}"; path.display()))?;
    let mut enc = png::Encoder::new(std::io::BufWriter::new(f), width, height);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let mut w = enc.write_header().map_err(|e| e.to_string())?;
    w.write_image_data(rgba).map_err(|e| e.to_string())?;
    w.finish().map_err(|e| e.to_string())
}

fn paste_dir() -> PathBuf {
    std::env::temp_dir().join("AlphaTerm").join("pegadas")
}

/// Guarda la imagen del portapapeles y devuelve la ruta (None si no hay imagen).
#[tauri::command]
pub fn clipboard_image_to_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Ok(img) = app.clipboard().read_image() else { return Ok(None) };
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return Ok(None);
    }
    let dir = paste_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = dir.join(format!("pegada-{ms}.png"));
    write_png(&path, w, h, img.rgba())?;
    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guarda_un_png_valido() {
        let d = std::env::temp_dir().join(format!("alphaterm-clip-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("x.png");
        // 2×1: un píxel rojo y uno verde.
        write_png(&p, 2, 1, &[255, 0, 0, 255, 0, 255, 0, 255]).unwrap();
        let b = std::fs::read(&p).unwrap();
        assert_eq!(&b[..8], b"\x89PNG\r\n\x1a\n");
        assert!(write_png(&p, 2, 2, &[0; 4]).is_err(), "tamaño que no coincide");
        let _ = std::fs::remove_dir_all(&d);
    }
}
