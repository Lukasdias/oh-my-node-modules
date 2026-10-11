//! Deletion of selected `node_modules` directories.

pub mod remove;
pub mod safety;

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Instant, SystemTime};

use rayon::prelude::*;
use serde::Serialize;

use crate::delete::safety::SafetyCheck;
use crate::model::NodeModulesInfo;
use crate::util;

/// Controls how [`delete_selected`] removes its targets.
#[derive(Debug, Clone, Copy)]
pub struct DeleteOptions {
    /// Verify and tally results without touching the filesystem.
    pub dry_run: bool,
    /// Escalate through fallbacks for trees that refuse a single-shot removal.
    pub force: bool,
    /// Treat projects with a recently modified lockfile as in use.
    pub check_in_use: bool,
}

/// Outcome of attempting to delete one `node_modules` directory.
#[derive(Debug, Clone, Serialize)]
pub struct DeletionDetail {
    /// Absolute path of the attempted directory.
    pub path: PathBuf,
    /// Name of the owning project.
    pub project_name: String,
    /// Size of the directory in bytes, as discovered before deletion.
    pub size_bytes: u64,
    /// Whether the directory was (or, when dry running, would be) removed.
    pub success: bool,
    /// Failure reason when `success` is `false`.
    pub error: Option<String>,
    /// Wall-clock time spent on this target, in milliseconds.
    pub duration_ms: u64,
}

/// Aggregate outcome of deleting a batch of selected directories.
#[derive(Debug, Clone, Serialize)]
pub struct DeletionResult {
    /// Number of targets the batch attempted.
    pub total_attempted: usize,
    /// Number of targets removed (or, when dry running, eligible).
    pub successful: usize,
    /// Number of targets that failed.
    pub failed: usize,
    /// Sum of `size_bytes` over successful targets only.
    pub bytes_freed: u64,
    /// Per-target outcomes. Input order is not guaranteed.
    pub details: Vec<DeletionDetail>,
}

impl DeletionResult {
    /// Render [`Self::bytes_freed`] with binary units, e.g. `"1.5 GB"`.
    pub fn formatted_bytes_freed(&self) -> String {
        util::format_bytes(self.bytes_freed)
    }
}

/// Delete every selected `node_modules` directory concurrently.
///
/// Each target is run through [`safety::check`] first. A check that is not
/// [`SafetyCheck::Ok`] fails that target with a descriptive error and does not
/// stop the batch. Under `opts.dry_run`, targets that pass the check succeed
/// without touching the filesystem. Otherwise they are removed with
/// [`remove::remove_fast`], or [`remove::remove_forced`] when `opts.force` is
/// set.
///
/// `on_progress(done, total)` is invoked once per target; `done` is a unique
/// 1-based completion sequence and the call order is not deterministic.
/// Aggregation and callback invocation never panic.
pub fn delete_selected(
    items: &[&NodeModulesInfo],
    opts: &DeleteOptions,
    now: SystemTime,
    on_progress: &(dyn Fn(usize, usize) + Sync + Send),
) -> DeletionResult {
    let total = items.len();
    let done = AtomicUsize::new(0);

    let details: Vec<DeletionDetail> = items
        .par_iter()
        .map(|item| {
            let detail = process_target(item, opts, now);
            let completed = done.fetch_add(1, Ordering::SeqCst) + 1;
            on_progress(completed, total);
            detail
        })
        .collect();

    let successful = details.iter().filter(|detail| detail.success).count();
    let bytes_freed = details
        .iter()
        .filter(|detail| detail.success)
        .map(|detail| detail.size_bytes)
        .sum();

    DeletionResult {
        total_attempted: total,
        successful,
        failed: total - successful,
        bytes_freed,
        details,
    }
}

/// Run the safety check and (unless dry running) the removal for one target.
fn process_target(item: &NodeModulesInfo, opts: &DeleteOptions, now: SystemTime) -> DeletionDetail {
    let started = Instant::now();

    let outcome = match safety::check(&item.path, opts.check_in_use, now) {
        SafetyCheck::Ok if opts.dry_run => Ok(()),
        SafetyCheck::Ok if opts.force => {
            remove::remove_forced(&item.path).map_err(|err| err.to_string())
        }
        SafetyCheck::Ok => remove::remove_fast(&item.path).map_err(|err| err.to_string()),
        failed => Err(check_failure_message(failed)),
    };

    let (success, error) = match outcome {
        Ok(()) => (true, None),
        Err(message) => (false, Some(message)),
    };

    DeletionDetail {
        path: item.path.clone(),
        project_name: item.project_name.clone(),
        size_bytes: item.size_bytes,
        success,
        error,
        duration_ms: elapsed_millis(started),
    }
}

/// Human-readable reason a [`SafetyCheck`] refused to allow deletion.
fn check_failure_message(check: SafetyCheck) -> String {
    match check {
        SafetyCheck::NotNodeModules => "path is not named node_modules".to_string(),
        SafetyCheck::Missing => "path does not exist".to_string(),
        SafetyCheck::InUse => "project appears in use (lockfile modified recently)".to_string(),
        SafetyCheck::NotValid => "path is not a valid node_modules directory".to_string(),
        SafetyCheck::Ok => "path passed the safety check".to_string(),
    }
}

/// Milliseconds elapsed since `started`, saturating on unrepresentable values.
fn elapsed_millis(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::SystemTime;

    use crate::model::{AgeCategory, NodeModulesInfo, SizeCategory};

    /// A `NodeModulesInfo` with only the fields delete cares about meaningful.
    fn info(path: PathBuf, size_bytes: u64) -> NodeModulesInfo {
        NodeModulesInfo {
            project_path: path.parent().map(Path::to_path_buf).unwrap_or_default(),
            path,
            project_name: "demo".to_string(),
            project_version: None,
            repo_path: PathBuf::new(),
            size_bytes,
            package_count: 1,
            total_package_count: 1,
            last_modified: SystemTime::UNIX_EPOCH,
            selected: true,
            is_favorite: false,
            size_category: SizeCategory::Small,
            age_category: AgeCategory::Fresh,
            is_pending: false,
        }
    }

    /// Create `<root>/node_modules/react` so it passes the safety checks.
    fn make_node_modules(root: &Path) -> PathBuf {
        let nm = root.join("node_modules");
        std::fs::create_dir_all(nm.join("react")).unwrap();
        nm
    }

    fn options(dry_run: bool) -> DeleteOptions {
        DeleteOptions {
            dry_run,
            force: false,
            check_in_use: false,
        }
    }

    #[test]
    fn dry_run_deletes_nothing_and_reports_sizes() {
        let tmp = tempfile::tempdir().unwrap();
        let first = make_node_modules(&tmp.path().join("a"));
        let second = make_node_modules(&tmp.path().join("b"));
        let items = [info(first.clone(), 100), info(second.clone(), 250)];
        let refs: Vec<&NodeModulesInfo> = items.iter().collect();

        let result = delete_selected(&refs, &options(true), SystemTime::now(), &|_, _| {});

        assert_eq!(result.total_attempted, 2);
        assert_eq!(result.successful, 2);
        assert_eq!(result.failed, 0);
        assert_eq!(result.bytes_freed, 350);
        assert!(first.exists(), "dry run must not delete the directory");
        assert!(second.exists(), "dry run must not delete the directory");
    }

    #[test]
    fn deletes_multiple_targets_and_tallies_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let first = make_node_modules(&tmp.path().join("a"));
        let second = make_node_modules(&tmp.path().join("b"));
        let items = [info(first.clone(), 100), info(second.clone(), 250)];
        let refs: Vec<&NodeModulesInfo> = items.iter().collect();

        let result = delete_selected(&refs, &options(false), SystemTime::now(), &|_, _| {});

        assert_eq!(result.successful, 2);
        assert_eq!(result.failed, 0);
        assert_eq!(result.bytes_freed, 350);
        assert!(!first.exists(), "target must be removed");
        assert!(!second.exists(), "target must be removed");
    }

    #[test]
    fn failing_target_does_not_abort_batch() {
        let tmp = tempfile::tempdir().unwrap();
        let valid = make_node_modules(&tmp.path().join("a"));
        let fake = tmp.path().join("not_node_modules");
        std::fs::create_dir_all(fake.join("child")).unwrap();
        let items = [info(valid.clone(), 100), info(fake.clone(), 50)];
        let refs: Vec<&NodeModulesInfo> = items.iter().collect();

        let result = delete_selected(&refs, &options(false), SystemTime::now(), &|_, _| {});

        assert_eq!(result.total_attempted, 2);
        assert_eq!(result.successful, 1);
        assert_eq!(result.failed, 1);
        assert_eq!(result.bytes_freed, 100);
        assert!(!valid.exists(), "valid target must still be removed");

        let failed = result
            .details
            .iter()
            .find(|detail| !detail.success)
            .expect("one failing detail");
        assert_eq!(failed.path, fake);
        assert!(
            failed.error.is_some(),
            "failure must carry an error message"
        );
    }

    #[test]
    fn progress_callback_is_called_once_per_target() {
        let tmp = tempfile::tempdir().unwrap();
        let first = make_node_modules(&tmp.path().join("a"));
        let second = make_node_modules(&tmp.path().join("b"));
        let items = [info(first, 100), info(second, 250)];
        let refs: Vec<&NodeModulesInfo> = items.iter().collect();

        let calls = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&calls);
        delete_selected(&refs, &options(true), SystemTime::now(), &move |_, _| {
            counter.fetch_add(1, Ordering::SeqCst);
        });

        assert_eq!(calls.load(Ordering::SeqCst), items.len());
    }
}
