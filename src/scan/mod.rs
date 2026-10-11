//! Filesystem scanning: sizing and metadata enrichment for `node_modules`.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::SystemTime;

use rayon::prelude::*;

use crate::config::Config;
use crate::model::NodeModulesInfo;

pub mod discovery;
pub mod project;
pub mod size;

use self::discovery::ScanOptions;

/// Coarse stage of a scan, reported through [`ScanProgress`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Walking the filesystem for `node_modules` directories.
    Discovering,
    /// Sizing and enriching the discovered directories.
    Sizing,
    /// All work finished.
    Done,
}

/// A progress snapshot emitted during [`scan`].
#[derive(Debug, Clone, Copy)]
pub struct ScanProgress {
    /// Stage the scan is currently in.
    pub phase: Phase,
    /// Units completed in this phase (directories found or enriched).
    pub done: usize,
    /// Total units for this phase; `0` while [`Phase::Discovering`].
    pub total: usize,
}

/// The result of a [`scan`]: enriched directories plus non-fatal errors.
#[derive(Debug)]
pub struct ScanOutcome {
    /// Enriched `node_modules` directories. Order is not deterministic.
    pub node_modules: Vec<NodeModulesInfo>,
    /// Human-readable messages for a missing root or per-target failures.
    pub errors: Vec<String>,
}

/// Discover and enrich `node_modules` directories beneath `opts.root`.
///
/// Emits [`Phase::Discovering`] at the start and as each directory is found,
/// then [`Phase::Sizing`] as each `rayon` task finishes (enrichment runs in
/// parallel), and [`Phase::Done`] once complete. A missing root is reported
/// through [`ScanOutcome::errors`] and returns early; a per-target `enrich`
/// failure is likewise collected into `errors` rather than aborting the scan.
pub fn scan(
    opts: &ScanOptions,
    cfg: &Config,
    now: SystemTime,
    on_progress: &(dyn Fn(ScanProgress) + Sync + Send),
) -> ScanOutcome {
    on_progress(ScanProgress {
        phase: Phase::Discovering,
        done: 0,
        total: 0,
    });
    let discovered = discovery::discover(opts, &|count| {
        on_progress(ScanProgress {
            phase: Phase::Discovering,
            done: count,
            total: 0,
        });
    });

    if !opts.root.exists() {
        return ScanOutcome {
            node_modules: Vec::new(),
            errors: vec![format!("Scan root does not exist: {}", opts.root.display())],
        };
    }

    let total = discovered.len();
    on_progress(ScanProgress {
        phase: Phase::Sizing,
        done: 0,
        total,
    });

    let done = AtomicUsize::new(0);
    let results: Vec<Result<NodeModulesInfo, String>> = discovered
        .par_iter()
        .map(|path| {
            let outcome = project::enrich(path, cfg, now)
                .map_err(|err| format!("Error analyzing {}: {err}", path.display()));
            let completed = done.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(ScanProgress {
                phase: Phase::Sizing,
                done: completed,
                total,
            });
            outcome
        })
        .collect();

    let mut node_modules = Vec::with_capacity(results.len());
    let mut errors = Vec::new();
    for result in results {
        match result {
            Ok(info) => node_modules.push(info),
            Err(message) => errors.push(message),
        }
    }

    on_progress(ScanProgress {
        phase: Phase::Done,
        done: total,
        total,
    });

    ScanOutcome {
        node_modules,
        errors,
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::Mutex;
    use std::time::SystemTime;

    use crate::config::Config;
    use crate::scan::discovery::ScanOptions;
    use crate::scan::{Phase, ScanProgress, scan};

    /// Scan options rooted at `root` with no excludes and default traversal.
    fn options(root: &Path) -> ScanOptions {
        ScanOptions {
            root: root.to_path_buf(),
            include_hidden: false,
            max_depth: None,
            follow_symlinks: false,
            exclude: globset::GlobSet::empty(),
        }
    }

    /// A `Config` with no excludes and no favorites.
    fn config() -> Config {
        Config {
            exclude: globset::GlobSet::empty(),
            favorites: std::collections::HashSet::new(),
        }
    }

    /// Progress callback that discards every update.
    fn noop(_: ScanProgress) {}

    /// Write `bytes` zero bytes to `path`, creating parent directories.
    fn write(path: &Path, bytes: usize) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, vec![0u8; bytes]).unwrap();
    }

    #[test]
    fn scan_enriches_every_target_via_rayon() {
        let tmp = tempfile::tempdir().unwrap();
        write(&tmp.path().join("a/node_modules/x/index.js"), 10);
        write(&tmp.path().join("b/node_modules/y/index.js"), 20);
        write(&tmp.path().join("c/node_modules/z/index.js"), 30);

        let outcome = scan(&options(tmp.path()), &config(), SystemTime::now(), &noop);

        assert_eq!(outcome.node_modules.len(), 3);
        assert!(outcome.errors.is_empty());
        // Order is not deterministic; every target must still be enriched.
        assert!(outcome.node_modules.iter().all(|info| info.size_bytes > 0));
    }

    #[cfg(unix)]
    #[test]
    fn scan_reports_errors_without_aborting() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        write(&tmp.path().join("ok/node_modules/x/index.js"), 10);
        write(&tmp.path().join("also/node_modules/y/index.js"), 20);

        let locked = tmp.path().join("locked");
        write(&locked.join("node_modules/z/index.js"), 30);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();

        let outcome = scan(&options(tmp.path()), &config(), SystemTime::now(), &noop);

        // Restore before asserting so the tempdir can be cleaned up on failure.
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();

        // The unreadable project must not abort the scan for the others.
        assert_eq!(outcome.node_modules.len(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn scan_records_error_for_unreadable_target() {
        use std::os::unix::fs::PermissionsExt;

        // A project directory that is readable but not executable can still be
        // listed by discovery (names come from readdir), yet `enrich`'s stat
        // across it fails. That exercises the per-target error path without
        // aborting the scan.
        let tmp = tempfile::tempdir().unwrap();
        write(&tmp.path().join("ok/node_modules/x/index.js"), 10);

        let locked = tmp.path().join("locked");
        write(&locked.join("node_modules/z/index.js"), 30);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o400)).unwrap();

        let outcome = scan(&options(tmp.path()), &config(), SystemTime::now(), &noop);

        // Restore before asserting so the tempdir can be cleaned up on failure.
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(outcome.node_modules.len(), 1);
        assert_eq!(outcome.errors.len(), 1);
        assert!(outcome.errors[0].contains("locked/node_modules"));
    }

    #[test]
    fn scan_missing_root_reports_error() {
        let outcome = scan(
            &options(Path::new("/definitely/not/here")),
            &config(),
            SystemTime::now(),
            &noop,
        );

        assert!(outcome.node_modules.is_empty());
        assert!(!outcome.errors.is_empty());
    }

    #[test]
    fn progress_reaches_the_done_phase() {
        let tmp = tempfile::tempdir().unwrap();
        write(&tmp.path().join("a/node_modules/x/index.js"), 10);

        let seen = Mutex::new(Vec::new());
        scan(
            &options(tmp.path()),
            &config(),
            SystemTime::now(),
            &|progress| {
                seen.lock().unwrap().push(progress);
            },
        );

        let seen = seen.into_inner().unwrap();
        assert_eq!(
            seen.last().map(|progress| progress.phase),
            Some(Phase::Done)
        );
    }
}
