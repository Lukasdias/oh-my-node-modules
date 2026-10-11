#![forbid(unsafe_code)]

pub mod cli;
pub mod config;
pub mod model;
pub mod util;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
