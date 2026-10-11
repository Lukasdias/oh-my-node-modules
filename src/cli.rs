use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, ValueEnum};

/// Command-line arguments for `onm`.
#[derive(Parser, Debug)]
#[command(
    name = "onm",
    version,
    about = "Find and clean up node_modules directories"
)]
pub struct Cli {
    /// Path to scan (defaults to the current directory).
    pub path: Option<PathBuf>,

    /// Report node_modules sizes without deleting anything.
    #[arg(long)]
    pub scan: bool,

    /// Delete every discovered node_modules without prompting.
    #[arg(long)]
    pub auto: bool,

    /// Emit machine-readable JSON on stdout.
    #[arg(long)]
    pub json: bool,

    /// Show what would be deleted without removing anything.
    #[arg(long = "dry-run")]
    pub dry_run: bool,

    /// Force removal with permission fixes and a rename fallback.
    #[arg(long)]
    pub force: bool,

    /// Skip confirmation prompts.
    #[arg(long)]
    pub yes: bool,

    /// Only target node_modules at least this large (for example `500mb`).
    #[arg(long = "min-size", value_name = "SIZE")]
    pub min_size: Option<String>,

    /// Sort key for the interactive picker.
    #[arg(long, value_enum, default_value_t)]
    pub sort: SortArg,

    /// Maximum directory depth to descend.
    #[arg(long = "max-depth", value_name = "N")]
    pub max_depth: Option<usize>,

    /// Include hidden directories.
    #[arg(long)]
    pub hidden: bool,

    /// Skip the in-use lockfile check.
    #[arg(long = "no-check")]
    pub no_check: bool,

    /// Reverse the sort order.
    #[arg(long)]
    pub asc: bool,
}

/// Sort key for the interactive picker.
#[derive(ValueEnum, Clone, Copy, Debug, Default)]
pub enum SortArg {
    /// Largest node_modules first.
    #[default]
    Size,
    /// Most recently modified first.
    Date,
    /// Project name, alphabetically.
    Name,
    /// Package count, descending.
    Packages,
}

/// Entry point shared by the binary and tests.
pub fn run(_cli: Cli) -> ExitCode {
    ExitCode::SUCCESS
}
