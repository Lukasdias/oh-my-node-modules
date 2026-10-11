#![forbid(unsafe_code)]

use std::process::ExitCode;

use clap::Parser;
use oh_my_node_modules::cli::{self, Cli};

fn main() -> ExitCode {
    cli::run(Cli::parse())
}
