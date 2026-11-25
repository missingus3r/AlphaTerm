// No extra console in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    alphaterm_lib::run()
}
