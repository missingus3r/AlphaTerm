//! Agrupado de la salida del PTY y contrapresión.
//!
//! El lector manda trozos crudos por un canal acotado. Este módulo los junta y los entrega:
//! - Un trozo que llega después de un rato sin salida se manda enseguida (eco de teclas sin demora).
//! - Si llega dentro de la ventana del envío anterior, estamos en ráfaga: se junta durante la
//!   ventana (~4 ms) o hasta `max_bytes` (64 KB), y se manda todo junto.
//! - `Flow` cuenta los bytes enviados y todavía no confirmados por el frontend. Si pasan la marca
//!   alta, el agrupador espera hasta bajar de la marca baja. Mientras espera no lee del canal, el
//!   canal acotado se llena, el lector se bloquea y ConPTY frena al proceso que escribe.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, TryRecvError};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug)]
pub struct BatchConfig {
    pub window: Duration,
    pub max_bytes: usize,
}

impl Default for BatchConfig {
    fn default() -> Self {
        Self { window: Duration::from_millis(4), max_bytes: 64 * 1024 }
    }
}

/// Bytes en vuelo entre el backend y xterm.js.
pub struct Flow {
    pending: Mutex<u64>,
    cv: Condvar,
    closed: AtomicBool,
    high: u64,
    low: u64,
}

impl Flow {
    pub fn new(high: u64, low: u64) -> Self {
        Self { pending: Mutex::new(0), cv: Condvar::new(), closed: AtomicBool::new(false), high, low }
    }

    pub fn add(&self, n: u64) {
        *self.pending.lock().unwrap() += n;
    }

    pub fn ack(&self, n: u64) {
        let mut p = self.pending.lock().unwrap();
        *p = p.saturating_sub(n);
        self.cv.notify_all();
    }

    pub fn pending(&self) -> u64 {
        *self.pending.lock().unwrap()
    }

    /// Libera a quien esté esperando (la sesión se cierra).
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.cv.notify_all();
    }

    /// Si se pasó la marca alta, bloquea hasta bajar de la baja (histéresis).
    pub fn wait_for_room(&self) {
        let mut p = self.pending.lock().unwrap();
        if *p <= self.high {
            return;
        }
        while *p > self.low && !self.closed.load(Ordering::SeqCst) {
            p = self.cv.wait_timeout(p, Duration::from_millis(250)).unwrap().0;
        }
    }
}

fn drain_ready(rx: &Receiver<Vec<u8>>, buf: &mut Vec<u8>, max: usize) -> bool {
    while buf.len() < max {
        match rx.try_recv() {
            Ok(chunk) => buf.extend_from_slice(&chunk),
            Err(TryRecvError::Empty) => return true,
            Err(TryRecvError::Disconnected) => return false,
        }
    }
    true
}

/// Corre hasta que el lector cierre el canal o `sink` devuelva `false`.
pub fn run(rx: Receiver<Vec<u8>>, cfg: BatchConfig, flow: &Flow, mut sink: impl FnMut(Vec<u8>) -> bool) {
    let mut last_flush: Option<Instant> = None;
    while let Ok(first) = rx.recv() {
        let mut buf = first;
        let mut open = drain_ready(&rx, &mut buf, cfg.max_bytes);
        let in_burst = last_flush.is_some_and(|t| t.elapsed() < cfg.window);
        if open && in_burst {
            let deadline = Instant::now() + cfg.window;
            while buf.len() < cfg.max_bytes {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    break;
                }
                match rx.recv_timeout(left) {
                    Ok(chunk) => buf.extend_from_slice(&chunk),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => {
                        open = false;
                        break;
                    }
                }
            }
        }
        flow.wait_for_room();
        flow.add(buf.len() as u64);
        if !sink(buf) {
            return;
        }
        last_flush = Some(Instant::now());
        if !open {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::sync_channel;
    use std::sync::Arc;
    use std::thread;

    fn collect(chunks: Vec<(u64, Vec<u8>)>, cfg: BatchConfig) -> Vec<Vec<u8>> {
        let (tx, rx) = sync_channel::<Vec<u8>>(64);
        let flow = Flow::new(u64::MAX, 0);
        let prod = thread::spawn(move || {
            for (delay_ms, c) in chunks {
                thread::sleep(Duration::from_millis(delay_ms));
                tx.send(c).unwrap();
            }
        });
        let mut out = Vec::new();
        run(rx, cfg, &flow, |b| {
            out.push(b);
            true
        });
        prod.join().unwrap();
        out
    }

    #[test]
    fn primer_trozo_sale_enseguida() {
        let cfg = BatchConfig { window: Duration::from_millis(50), max_bytes: 1024 };
        let (tx, rx) = sync_channel::<Vec<u8>>(4);
        let flow = Flow::new(u64::MAX, 0);
        let start = Instant::now();
        tx.send(b"a".to_vec()).unwrap();
        let mut elapsed = None;
        let h = thread::spawn(move || {
            thread::sleep(Duration::from_millis(200));
            drop(tx);
        });
        run(rx, cfg, &flow, |_| {
            elapsed.get_or_insert(start.elapsed());
            true
        });
        h.join().unwrap();
        assert!(elapsed.unwrap() < Duration::from_millis(30), "{elapsed:?}");
    }

    #[test]
    fn rafaga_se_agrupa() {
        let cfg = BatchConfig { window: Duration::from_millis(40), max_bytes: 1 << 20 };
        // 1 trozo suelto, después 10 trozos seguidos cada 1 ms.
        let mut chunks = vec![(0, b"x".to_vec())];
        chunks.extend((0..10).map(|_| (1, b"yy".to_vec())));
        let out = collect(chunks, cfg);
        let total: usize = out.iter().map(Vec::len).sum();
        assert_eq!(total, 21);
        assert!(out.len() <= 3, "se esperaban pocos envíos, hubo {}", out.len());
    }

    #[test]
    fn respeta_max_bytes() {
        let cfg = BatchConfig { window: Duration::from_millis(200), max_bytes: 10 };
        let chunks = (0..20).map(|_| (0, vec![b'z'; 4])).collect();
        let out = collect(chunks, cfg);
        assert_eq!(out.iter().map(Vec::len).sum::<usize>(), 80);
        // Un envío puede pasarse por un trozo como máximo.
        assert!(out.iter().all(|b| b.len() < 10 + 4));
    }

    #[test]
    fn contrapresion_frena_hasta_el_ack() {
        let cfg = BatchConfig { window: Duration::from_millis(1), max_bytes: 100 };
        let flow = Arc::new(Flow::new(150, 50));
        let (tx, rx) = sync_channel::<Vec<u8>>(1);
        let f2 = flow.clone();
        let consumer = thread::spawn(move || {
            let mut sent = Vec::new();
            run(rx, cfg, &f2, |b| {
                sent.push((Instant::now(), b.len()));
                true
            });
            sent
        });
        for _ in 0..4 {
            tx.send(vec![0u8; 100]).unwrap();
            thread::sleep(Duration::from_millis(5));
        }
        // 200 bytes en vuelo > 150: el tercer envío tiene que esperar el ack.
        thread::sleep(Duration::from_millis(100));
        assert!(flow.pending() <= 200, "pending = {}", flow.pending());
        let before_ack = Instant::now();
        flow.ack(200);
        drop(tx);
        let sent = consumer.join().unwrap();
        assert_eq!(sent.iter().map(|s| s.1).sum::<usize>(), 400);
        assert!(sent.iter().filter(|s| s.0 >= before_ack).count() >= 1);
    }

    #[test]
    fn close_libera_la_espera() {
        let flow = Arc::new(Flow::new(10, 5));
        flow.add(100);
        let f2 = flow.clone();
        let h = thread::spawn(move || f2.wait_for_room());
        thread::sleep(Duration::from_millis(30));
        flow.close();
        h.join().unwrap();
    }
}
