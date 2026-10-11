//! Discovery of project-level `node_modules` directories.

use std::ffi::OsStr;
use std::path::PathBuf;

use globset::GlobSet;
use ignore::{DirEntry, WalkBuilder};

use crate::config::is_excluded_by;

/// Directory name collected by [`discover`].
const NODE_MODULES: &str = "node_modules";

/// Options controlling a `node_modules` discovery walk.
#[derive(Debug)]
pub struct ScanOptions {
    /// Root directory to search, walked in absolute form so results are absolute.
    pub root: PathBuf,
    /// Whether to descend into hidden directories (names beginning with `.`).
    pub include_hidden: bool,
    /// Maximum directory depth below the root (`root` is depth 0); `None` is
    /// unlimited.
    pub max_depth: Option<usize>,
    /// Whether to follow symbolic links while walking.
    pub follow_symlinks: bool,
    /// Compiled exclusion patterns; matching subtrees are pruned.
    pub exclude: GlobSet,
}

/// Find project-level `node_modules` directories beneath `opts.root`.
///
/// `root` is made absolute with [`std::path::absolute`] before walking, so every
/// returned path is absolute. Traversal is a plain walk: the `ignore` crate's
/// gitignore, `.ignore`, global, and parent handling are all disabled, hidden
/// entries are skipped unless `opts.include_hidden`, and symbolic links are
/// followed only when `opts.follow_symlinks` is set.
///
/// Pruning keeps only the shallowest `node_modules` in each branch. An entry is
/// skipped when an ancestor component is already named `node_modules`, or when
/// it matches `opts.exclude`. A `node_modules` directory itself is never pruned
/// by `opts.exclude`: the default excludes include `**/node_modules/**`, which
/// matches the directory and would otherwise drop every result. Its children
/// are still pruned by the ancestor rule, so nested dependency installs are
/// never reported.
///
/// `on_found` is called with the running count after each directory is pushed.
/// Per-entry walk errors (for example an unreadable directory) are ignored and
/// the walk continues; a missing or unreadable root yields an empty vector.
pub fn discover(opts: &ScanOptions, on_found: &(dyn Fn(usize) + Sync + Send)) -> Vec<PathBuf> {
    let root = std::path::absolute(&opts.root).unwrap_or_else(|_| opts.root.clone());
    let exclude = opts.exclude.clone();

    let walker = WalkBuilder::new(&root)
        .hidden(!opts.include_hidden)
        .ignore(false)
        .git_ignore(false)
        .git_global(false)
        .git_exclude(false)
        .parents(false)
        .follow_links(opts.follow_symlinks)
        .max_depth(opts.max_depth)
        .filter_entry(move |entry| !should_prune(entry, &exclude))
        .build();

    let mut found = Vec::new();
    for entry in walker {
        // Unreadable entries surface as errors; skip them and keep walking.
        let Ok(entry) = entry else {
            continue;
        };
        if entry.file_name() != OsStr::new(NODE_MODULES) {
            continue;
        }
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_dir())
        {
            continue;
        }
        found.push(entry.into_path());
        on_found(found.len());
    }

    found
}

/// Whether the walker should skip `entry` and, for a directory, its subtree.
///
/// Skips anything inside an existing `node_modules`, keeps a `node_modules`
/// directory itself (it is the collected unit), and prunes anything else that
/// matches `exclude`. The `node_modules` exemption exists because the default
/// excludes include `**/node_modules/**`, which matches the directory itself.
fn should_prune(entry: &DirEntry, exclude: &GlobSet) -> bool {
    let path = entry.path();

    let inside_node_modules = path
        .ancestors()
        .skip(1)
        .any(|ancestor| ancestor.file_name() == Some(OsStr::new(NODE_MODULES)));
    if inside_node_modules {
        return true;
    }

    if entry.file_name() == OsStr::new(NODE_MODULES) {
        return false;
    }

    is_excluded_by(exclude, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// Options rooted at `root` that skip hidden dirs and apply no excludes.
    fn options(root: &Path) -> ScanOptions {
        ScanOptions {
            root: root.to_path_buf(),
            include_hidden: false,
            max_depth: None,
            follow_symlinks: false,
            exclude: globset::GlobSet::empty(),
        }
    }

    /// Progress callback that ignores the count.
    fn noop(_: usize) {}

    /// Compile exclusion patterns the way [`crate::config::load`] does, adding
    /// each `foo/**` pattern with and without its trailing `/**`.
    fn exclude(patterns: &[&str]) -> globset::GlobSet {
        let mut builder = globset::GlobSetBuilder::new();
        for pattern in patterns {
            builder.add(globset::Glob::new(pattern).unwrap());
            if let Some(dir) = pattern.strip_suffix("/**") {
                builder.add(globset::Glob::new(dir).unwrap());
            }
        }
        builder.build().unwrap()
    }

    /// Sort so assertions do not depend on walk order.
    fn sorted(mut paths: Vec<PathBuf>) -> Vec<PathBuf> {
        paths.sort();
        paths
    }

    #[test]
    fn finds_project_level_node_modules_at_depth() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("a/node_modules")).unwrap();
        fs::create_dir_all(tmp.path().join("a/b/c/node_modules")).unwrap();

        let found = sorted(discover(&options(tmp.path()), &noop));
        let expected = sorted(vec![
            tmp.path().join("a/b/c/node_modules"),
            tmp.path().join("a/node_modules"),
        ]);
        assert_eq!(found, expected);
    }

    #[test]
    fn prunes_nested_node_modules() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("app/node_modules/pkg/node_modules")).unwrap();

        let found = discover(&options(tmp.path()), &noop);
        assert_eq!(found, vec![tmp.path().join("app/node_modules")]);
    }

    #[test]
    fn skips_hidden_dirs_by_default() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join(".hidden/node_modules")).unwrap();

        let mut opts = options(tmp.path());
        assert!(discover(&opts, &noop).is_empty());

        opts.include_hidden = true;
        assert_eq!(
            discover(&opts, &noop),
            vec![tmp.path().join(".hidden/node_modules")]
        );
    }

    #[test]
    fn respects_max_depth() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("a/b/c/node_modules")).unwrap();

        let mut opts = options(tmp.path());
        opts.max_depth = Some(2);
        assert!(discover(&opts, &noop).is_empty());

        opts.max_depth = None;
        assert_eq!(
            discover(&opts, &noop),
            vec![tmp.path().join("a/b/c/node_modules")]
        );
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_symlinked_dirs() {
        let root = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        fs::create_dir_all(target.path().join("node_modules")).unwrap();
        std::os::unix::fs::symlink(target.path(), root.path().join("link")).unwrap();

        assert!(discover(&options(root.path()), &noop).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn continues_past_permission_denied_dir() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("locked")).unwrap();
        fs::create_dir_all(tmp.path().join("ok/node_modules")).unwrap();

        let locked = tmp.path().join("locked");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();

        let found = discover(&options(tmp.path()), &noop);
        // Restore before asserting so the tempdir can be cleaned up on failure.
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(found, vec![tmp.path().join("ok/node_modules")]);
    }

    #[test]
    fn handles_deeply_nested_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let mut deep = tmp.path().to_path_buf();
        for level in 0..60 {
            deep.push(format!("d{level}"));
        }
        fs::create_dir_all(deep.join("node_modules")).unwrap();

        assert_eq!(
            discover(&options(tmp.path()), &noop),
            vec![deep.join("node_modules")]
        );
    }

    #[test]
    fn keeps_node_modules_despite_node_modules_exclude() {
        // `config::load`'s defaults include `**/node_modules/**`, which matches
        // the directory itself; discovery must still collect it.
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("app/node_modules")).unwrap();

        let mut opts = options(tmp.path());
        opts.exclude = exclude(&["**/node_modules/**"]);
        assert_eq!(
            discover(&opts, &noop),
            vec![tmp.path().join("app/node_modules")]
        );
    }

    #[test]
    fn prunes_excluded_subtree() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("dist/node_modules")).unwrap();
        fs::create_dir_all(tmp.path().join("src/node_modules")).unwrap();

        let mut opts = options(tmp.path());
        opts.exclude = exclude(&["**/dist/**"]);
        assert_eq!(
            discover(&opts, &noop),
            vec![tmp.path().join("src/node_modules")]
        );
    }

    #[test]
    fn reports_running_count_to_callback() {
        use std::sync::Mutex;

        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("a/node_modules")).unwrap();
        fs::create_dir_all(tmp.path().join("b/node_modules")).unwrap();

        let counts = Mutex::new(Vec::new());
        discover(&options(tmp.path()), &|count| {
            if let Ok(mut seen) = counts.lock() {
                seen.push(count);
            }
        });

        let mut seen = counts.into_inner().unwrap();
        seen.sort();
        assert_eq!(seen, vec![1, 2]);
    }
}
