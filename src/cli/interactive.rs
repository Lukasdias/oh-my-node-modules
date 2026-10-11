//! Interactive scan, pick, confirm, and delete flow.

use std::process::ExitCode;
use std::time::{Duration, SystemTime};

use indicatif::{ProgressBar, ProgressStyle};

use crate::cli::Cli;
use crate::delete::{DeleteOptions, delete_selected};
use crate::model::NodeModulesInfo;
use crate::ui::picker;
use crate::ui::report;
use crate::ui::theme;
use crate::util::{format_bytes, write_line};

/// Run the interactive flow for `cli`.
///
/// Scans `cli.path` (defaulting to the current directory), lets the user pick
/// directories to delete, confirms, and deletes them. A nonexistent root exits
/// with [`ExitCode::FAILURE`]; an empty result or a cancelled prompt exits with
/// [`ExitCode::SUCCESS`] without touching the filesystem.
pub fn run(cli: &Cli) -> ExitCode {
    let mut run = match super::scan_cli(cli) {
        Ok(run) => run,
        Err(code) => return code,
    };

    if run.outcome.node_modules.is_empty() {
        write_line("No node_modules found.");
        return ExitCode::SUCCESS;
    }

    let summary = report::summary_line(&run.outcome, run.now);
    picker::sort_items(&mut run.outcome.node_modules, cli.sort, cli.asc);
    write_line(&summary);

    let Some(indices) = picker::pick(&run.outcome.node_modules) else {
        write_line("Cancelled.");
        return ExitCode::SUCCESS;
    };
    let selected: Vec<&NodeModulesInfo> = indices
        .iter()
        .filter_map(|&index| run.outcome.node_modules.get(index))
        .collect();
    if selected.is_empty() {
        write_line("Nothing selected.");
        return ExitCode::SUCCESS;
    }

    let bytes: u64 = selected.iter().map(|item| item.size_bytes).sum();
    let question = format!(
        "Delete {} directories ({})?",
        selected.len(),
        format_bytes(bytes)
    );
    if !picker::confirm(&question) {
        write_line("Cancelled.");
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
        write_line(&format!(
            "[DRY RUN] Would free {} from {} directories",
            result.formatted_bytes_freed(),
            result.successful
        ));
    } else {
        write_line(&format!(
            "Freed {} from {} directories",
            result.formatted_bytes_freed(),
            result.successful
        ));
    }
    ExitCode::SUCCESS
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
