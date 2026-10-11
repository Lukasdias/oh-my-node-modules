//! Project metadata enrichment for a discovered `node_modules` directory.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::config::Config;
use crate::model::{self, NodeModulesInfo};
use crate::scan::size::dir_stats;

/// Read `name` and `version` from `project/package.json`.
///
/// Returns `Some((name, version))` when the file exists and parses as JSON, with
/// either field `None` when absent or not a JSON string. A missing or invalid
/// file yields `None`.
pub fn read_package_json(project: &Path) -> Option<(Option<String>, Option<String>)> {
    let contents = fs::read_to_string(project.join("package.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;

    let name = value
        .get("name")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);

    Some((name, version))
}

/// Find the nearest ancestor of `start` (inclusive) holding a `.git` entry.
///
/// `.git` may be a directory (a normal clone) or a file (a linked worktree or
/// submodule), so the entry's existence is checked without following it.
/// Ascends to the filesystem root and returns `start` unchanged when no
/// ancestor qualifies.
pub fn find_repo_root(start: &Path) -> PathBuf {
    start
        .ancestors()
        .find(|candidate| fs::symlink_metadata(candidate.join(".git")).is_ok())
        .unwrap_or(start)
        .to_path_buf()
}

/// Enrich a `node_modules` directory with project, repository, size, and age
/// metadata.
///
/// `nm_path` must be the `node_modules` directory itself; its parent is treated
/// as the owning project. `is_favorite` is set when `cfg.favorites` contains the
/// project path or the `node_modules` path (exact, non-canonicalized `PathBuf`
/// comparison, matching how [`Config`] stores favorites). The directory's
/// modification time supplies `last_modified`, falling back to `now` when the
/// platform cannot report it.
pub fn enrich(nm_path: &Path, cfg: &Config, now: SystemTime) -> io::Result<NodeModulesInfo> {
    let stats = dir_stats(nm_path)?;

    let project_path = nm_path.parent().unwrap_or(nm_path).to_path_buf();
    let (name, version) = read_package_json(&project_path).unwrap_or((None, None));

    let last_modified = fs::metadata(nm_path)?.modified().unwrap_or(now);

    // Prefer a non-empty `package.json` name, then the project directory name.
    let project_name = name
        .filter(|value| !value.is_empty())
        .or_else(|| {
            project_path
                .file_name()
                .map(|file_name| file_name.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| nm_path.display().to_string());

    let is_favorite = cfg.favorites.contains(&project_path) || cfg.favorites.contains(nm_path);
    let repo_path = find_repo_root(&project_path);

    Ok(NodeModulesInfo {
        path: nm_path.to_path_buf(),
        project_path,
        project_name,
        project_version: version,
        repo_path,
        size_bytes: stats.total_size,
        package_count: stats.package_count,
        total_package_count: stats.total_package_count,
        last_modified,
        selected: false,
        is_favorite,
        size_category: model::size_category(stats.total_size),
        age_category: model::age_category(last_modified, now),
        is_pending: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::model::SizeCategory;
    use std::collections::HashSet;
    use std::fs;
    use std::time::SystemTime;

    /// A `Config` with no exclude patterns and no favorites.
    fn empty_config() -> Config {
        Config {
            exclude: globset::GlobSet::empty(),
            favorites: HashSet::new(),
        }
    }

    #[test]
    fn enrich_reads_name_version_and_categories() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(
            tmp.path().join("package.json"),
            r#"{"name":"demo","version":"2.1.0"}"#,
        )
        .unwrap();
        let nm = tmp.path().join("node_modules");
        fs::create_dir_all(nm.join("react")).unwrap();
        fs::write(nm.join("react/index.js"), b"x").unwrap();

        let info = enrich(&nm, &empty_config(), SystemTime::now()).unwrap();

        assert_eq!(info.project_name, "demo");
        assert_eq!(info.project_version.as_deref(), Some("2.1.0"));
        assert_eq!(info.project_path, tmp.path());
        // The fixture has no `.git` ancestor, so the project path is the root.
        assert_eq!(info.repo_path, tmp.path());
        assert_eq!(info.path, nm);
        assert_eq!(info.size_bytes, 1);
        assert_eq!(info.package_count, 1);
        assert_eq!(info.total_package_count, 1);
        assert_eq!(info.size_category, SizeCategory::Small);
        assert!(!info.selected);
        assert!(!info.is_pending);
    }

    #[test]
    fn enrich_falls_back_to_directory_name_without_package_json() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("myproj");
        let nm = project.join("node_modules");
        fs::create_dir_all(&nm).unwrap();

        let info = enrich(&nm, &empty_config(), SystemTime::now()).unwrap();

        assert_eq!(info.project_name, "myproj");
        assert!(info.project_version.is_none());
        assert_eq!(info.project_path, project);
    }

    #[test]
    fn read_package_json_returns_none_for_invalid_or_missing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(read_package_json(tmp.path()).is_none());

        fs::write(tmp.path().join("package.json"), "{ not json").unwrap();
        assert!(read_package_json(tmp.path()).is_none());

        fs::write(tmp.path().join("package.json"), r#"{"private":true}"#).unwrap();
        assert_eq!(read_package_json(tmp.path()), Some((None, None)));
    }

    #[test]
    fn find_repo_root_walks_up_to_dot_git() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join(".git")).unwrap();
        let nested = tmp.path().join("a/b/node_modules");
        fs::create_dir_all(&nested).unwrap();

        assert_eq!(find_repo_root(&tmp.path().join("a/b")), tmp.path());
        assert_eq!(find_repo_root(&nested), tmp.path());
    }

    #[test]
    fn find_repo_root_accepts_dot_git_file() {
        // Worktrees and submodules store `.git` as a file, not a directory.
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(".git"), "gitdir: /elsewhere\n").unwrap();
        let nested = tmp.path().join("x/node_modules");
        fs::create_dir_all(&nested).unwrap();

        assert_eq!(find_repo_root(&nested), tmp.path());
    }

    #[test]
    fn find_repo_root_returns_start_without_dot_git() {
        let tmp = tempfile::tempdir().unwrap();
        let start = tmp.path().join("lonely/deep");
        fs::create_dir_all(&start).unwrap();

        assert_eq!(find_repo_root(&start), start);
    }

    #[test]
    fn enrich_marks_favorites() {
        let tmp = tempfile::tempdir().unwrap();
        let nm = tmp.path().join("node_modules");
        fs::create_dir_all(&nm).unwrap();

        // Favorite recorded as the `node_modules` path.
        let mut by_nm = empty_config();
        by_nm.favorites.insert(nm.clone());
        assert!(enrich(&nm, &by_nm, SystemTime::now()).unwrap().is_favorite);

        // Favorite recorded as the project (parent) path.
        let mut by_project = empty_config();
        by_project.favorites.insert(tmp.path().to_path_buf());
        assert!(
            enrich(&nm, &by_project, SystemTime::now())
                .unwrap()
                .is_favorite
        );

        assert!(
            !enrich(&nm, &empty_config(), SystemTime::now())
                .unwrap()
                .is_favorite
        );
    }
}
