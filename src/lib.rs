#![forbid(unsafe_code)]

pub mod cli;
pub mod config;
pub mod delete;
pub mod model;
pub mod scan;
pub mod ui;
pub mod util;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
