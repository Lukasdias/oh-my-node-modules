use std::path::PathBuf;
use std::process::ExitCode;
use std::time::SystemTime;

use clap::{Parser, ValueEnum};

use crate::config;
use crate::delete::{DeleteOptions, delete_selected};
use crate::model::NodeModulesInfo;
use crate::scan::ScanOutcome;
use crate::scan::discovery::ScanOptions;
use crate::scan::scan;
use crate::ui::picker;
use crate::ui::progress::ScanSpinner;
use crate::ui::report;
use crate::ui::theme;
use crate::util::{format_bytes, parse_size};

pub mod interactive;

/// Number of scan errors printed before the remainder is summarized.
const MAX_REPORTED_ERRORS: usize = 5;

/// Number of rows in the `--scan` table before the remainder is summarized.
const TABLE_LIMIT: usize = 20;

/// Number of auto-delete paths listed before the remainder is summarized.
const AUTO_PREVIEW_LIMIT: usize = 10;

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
///
/// `--auto` runs the non-interactive batch, `--scan`/`--json` produce a report,
/// and anything else falls through to the interactive flow.
pub fn run(cli: Cli) -> ExitCode {
    if cli.auto {
        return run_auto(&cli);
    }
    if cli.scan || cli.json {
        return run_scan_mode(&cli);
    }
    interactive::run(&cli)
}

/// The resolved context of a completed scan.
pub(crate) struct ScanRun {
    /// Working directory the scan was launched from, for relative display.
    pub cwd: PathBuf,
    /// Time the scan was taken, shared by summary and age rendering.
    pub now: SystemTime,
    /// Discovered and enriched directories plus non-fatal errors.
    pub outcome: ScanOutcome,
}

/// Scan `cli`'s root with a spinner, reporting discovery errors to stderr.
///
/// Returns [`ExitCode::FAILURE`] (after reporting once) when the root does not
/// exist, so missing roots never reach a destructive path.
pub(crate) fn scan_cli(cli: &Cli) -> Result<ScanRun, ExitCode> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let root = resolve_root(cli);
    let cfg = config::load(&cwd, home_dir().as_deref());

    let opts = ScanOptions {
        root: root.clone(),
        include_hidden: cli.hidden,
        max_depth: cli.max_depth,
        follow_symlinks: false,
        exclude: cfg.exclude.clone(),
    };

    let now = SystemTime::now();
    let spinner = ScanSpinner::new();
    let outcome = scan(&opts, &cfg, now, &|progress| spinner.update(progress));
    spinner.finish("Scan complete");

    report_scan_errors(&outcome.errors);

    if !root.exists() {
        if outcome.errors.is_empty() {
            eprintln!(
                "{}",
                theme::paint(
                    "red",
                    &format!("error: scan root does not exist: {}", root.display()),
                )
            );
        }
        return Err(ExitCode::FAILURE);
    }

    Ok(ScanRun { cwd, now, outcome })
}

/// Report mode: a colored table with a total, or a JSON array.
fn run_scan_mode(cli: &Cli) -> ExitCode {
    let mut run = match scan_cli(cli) {
        Ok(run) => run,
        Err(code) => return code,
    };
    picker::sort_items(&mut run.outcome.node_modules, cli.sort, cli.asc);

    if cli.json {
        return print_json(&run.outcome.node_modules, "scan results");
    }

    report::print_table(&run.outcome.node_modules, TABLE_LIMIT, run.now, &run.cwd);

    let total_bytes: u64 = run
        .outcome
        .node_modules
        .iter()
        .map(|item| item.size_bytes)
        .sum();
    let projects = count_label(run.outcome.node_modules.len(), "project");
    println!(
        "Total: {} across {} {projects}",
        format_bytes(total_bytes),
        run.outcome.node_modules.len()
    );
    ExitCode::SUCCESS
}

/// Non-interactive batch delete of the largest matching directories.
fn run_auto(cli: &Cli) -> ExitCode {
    let min_size = match cli.min_size.as_deref() {
        Some(raw) => match parse_size(raw) {
            Ok(bytes) => Some(bytes),
            Err(err) => {
                eprintln!("{}", theme::paint("red", &format!("error: {err}")));
                return ExitCode::FAILURE;
            }
        },
        None => None,
    };

    let mut run = match scan_cli(cli) {
        Ok(run) => run,
        Err(code) => return code,
    };
    picker::sort_items(&mut run.outcome.node_modules, cli.sort, cli.asc);

    let selected: Vec<&NodeModulesInfo> = run
        .outcome
        .node_modules
        .iter()
        .filter(|item| min_size.is_none_or(|min| item.size_bytes >= min))
        .collect();

    if selected.is_empty() {
        println!("Nothing matched - no node_modules to delete.");
        return ExitCode::SUCCESS;
    }

    let total_bytes: u64 = selected.iter().map(|item| item.size_bytes).sum();
    let prefix = if cli.dry_run { "[DRY RUN] " } else { "" };
    println!(
        "{prefix}Will delete {} directories ({}):",
        selected.len(),
        format_bytes(total_bytes)
    );
    for item in selected.iter().take(AUTO_PREVIEW_LIMIT) {
        println!("  {}", item.path.display());
    }
    if selected.len() > AUTO_PREVIEW_LIMIT {
        println!("... and {} more", selected.len() - AUTO_PREVIEW_LIMIT);
    }

    if cli.dry_run {
        println!(
            "[DRY RUN] Would free {} from {} directories",
            format_bytes(total_bytes),
            selected.len()
        );
        return ExitCode::SUCCESS;
    }

    if !cli.yes {
        let question = format!(
            "Delete {} directories ({})?",
            selected.len(),
            format_bytes(total_bytes)
        );
        if !picker::confirm(&question) {
            println!("Cancelled.");
            return ExitCode::SUCCESS;
        }
    }

    let opts = DeleteOptions {
        dry_run: false,
        force: cli.force,
        check_in_use: !cli.no_check,
    };
    let result = delete_selected(&selected, &opts, run.now, &|_, _| {});

    if cli.json {
        return print_json(&result, "deletion result");
    }

    for detail in result.details.iter().filter(|detail| !detail.success) {
        let reason = detail.error.as_deref().unwrap_or("unknown error");
        eprintln!(
            "{}",
            theme::paint(
                "red",
                &format!("failed: {} ({reason})", detail.path.display()),
            )
        );
    }
    println!(
        "Freed {} from {} directories",
        result.formatted_bytes_freed(),
        result.successful
    );
    ExitCode::SUCCESS
}

/// Serialize `value` as pretty JSON to stdout, or fail with a colored error.
fn print_json<T: serde::Serialize>(value: &T, what: &str) -> ExitCode {
    match serde_json::to_string_pretty(value) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!(
                "{}",
                theme::paint("red", &format!("error: failed to serialize {what}: {err}"),)
            );
            ExitCode::FAILURE
        }
    }
}

/// `singular` when `count == 1`, else the naive plural form.
fn count_label(count: usize, singular: &str) -> String {
    if count == 1 {
        singular.to_string()
    } else {
        format!("{singular}s")
    }
}

/// Resolve `cli.path`, defaulting to `.`, and absolutize it without resolving links.
fn resolve_root(cli: &Cli) -> PathBuf {
    let root = cli.path.clone().unwrap_or_else(|| PathBuf::from("."));
    std::path::absolute(&root).unwrap_or(root)
}

/// The user's home directory from `HOME`, then `USERPROFILE`; `None` if unset.
///
/// The value is never logged.
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

/// Print up to [`MAX_REPORTED_ERRORS`] scan errors to stderr, then a count.
pub(crate) fn report_scan_errors(errors: &[String]) {
    for message in errors.iter().take(MAX_REPORTED_ERRORS) {
        eprintln!("{}", theme::paint("red", &format!("error: {message}")));
    }
    if errors.len() > MAX_REPORTED_ERRORS {
        eprintln!("... and {} more errors", errors.len() - MAX_REPORTED_ERRORS);
    }
}
