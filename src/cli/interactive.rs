//! Interactive scan, pick, confirm, and delete flow.

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{Duration, SystemTime};

use indicatif::{ProgressBar, ProgressStyle};

use crate::cli::Cli;
use crate::config;
use crate::delete::{DeleteOptions, delete_selected};
use crate::model::NodeModulesInfo;
use crate::scan::discovery::ScanOptions;
use crate::scan::scan;
use crate::ui::picker;
use crate::ui::progress::ScanSpinner;
use crate::ui::report;
use crate::ui::theme;
use crate::util::format_bytes;

/// Number of scan errors printed before the remainder is summarized.
const MAX_REPORTED_ERRORS: usize = 5;

/// Run the interactive flow for `cli`.
///
/// Scans `cli.path` (defaulting to the current directory), lets the user pick
/// directories to delete, confirms, and deletes them. A nonexistent root exits
/// with [`ExitCode::FAILURE`]; an empty result or a cancelled prompt exits with
/// [`ExitCode::SUCCESS`] without touching the filesystem.
pub fn run(cli: &Cli) -> ExitCode {
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
        // The scan already reported a missing root; only speak up if it did not.
        if outcome.errors.is_empty() {
            eprintln!(
                "{}",
                theme::paint(
                    "red",
                    &format!("error: scan root does not exist: {}", root.display()),
                )
            );
        }
        return ExitCode::FAILURE;
    }

    let summary = report::summary_line(&outcome, now);
    let mut items = outcome.node_modules;
    if items.is_empty() {
        println!("No node_modules found.");
        return ExitCode::SUCCESS;
    }

    picker::sort_items(&mut items, cli.sort, cli.asc);
    println!("{summary}");

    let Some(indices) = picker::pick(&items) else {
        println!("Cancelled.");
        return ExitCode::SUCCESS;
    };
    let selected: Vec<&NodeModulesInfo> = indices
        .iter()
        .filter_map(|&index| items.get(index))
        .collect();
    if selected.is_empty() {
        println!("Nothing selected.");
        return ExitCode::SUCCESS;
    }

    let bytes: u64 = selected.iter().map(|item| item.size_bytes).sum();
    let question = format!(
        "Delete {} directories ({})?",
        selected.len(),
        format_bytes(bytes)
    );
    if !picker::confirm(&question) {
        println!("Cancelled.");
        return ExitCode::SUCCESS;
    }

    delete_and_report(&selected, cli)
}

/// Delete `selected`, rendering a progress bar and a per-failure summary.
///
/// Honors `cli.dry_run`: when set, the deletion only simulates and reports the
/// size that would have been freed.
fn delete_and_report(selected: &[&NodeModulesInfo], cli: &Cli) -> ExitCode {
    let opts = DeleteOptions {
        dry_run: cli.dry_run,
        force: cli.force,
        check_in_use: !cli.no_check,
    };

    let bar = deletion_bar(selected.len(), cli.dry_run);
    let result = delete_selected(selected, &opts, SystemTime::now(), &|done, total| {
        bar.set_length(total as u64);
        bar.set_position(done as u64);
    });
    bar.finish_with_message(if cli.dry_run {
        "Dry run complete"
    } else {
        "Deletion complete"
    });

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

    if cli.dry_run {
        println!(
            "[DRY RUN] Would free {} from {} directories",
            result.formatted_bytes_freed(),
            result.successful
        );
    } else {
        println!(
            "Freed {} from {} directories",
            result.formatted_bytes_freed(),
            result.successful
        );
    }
    ExitCode::SUCCESS
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

/// Build the fixed-width deletion progress bar, labelled for a real or dry run.
fn deletion_bar(total: usize, dry_run: bool) -> ProgressBar {
    let bar = ProgressBar::new(total as u64);
    bar.set_style(
        ProgressStyle::with_template("{msg} {wide_bar} {pos}/{len}")
            .unwrap_or_else(|_| ProgressStyle::default_bar()),
    );
    bar.set_message(if dry_run { "Dry run" } else { "Deleting" });
    bar.enable_steady_tick(Duration::from_millis(100));
    bar
}

/// Print up to [`MAX_REPORTED_ERRORS`] scan errors to stderr, then a count.
fn report_scan_errors(errors: &[String]) {
    for message in errors.iter().take(MAX_REPORTED_ERRORS) {
        eprintln!("{}", theme::paint("red", &format!("error: {message}")));
    }
    if errors.len() > MAX_REPORTED_ERRORS {
        eprintln!("... and {} more errors", errors.len() - MAX_REPORTED_ERRORS);
    }
}
