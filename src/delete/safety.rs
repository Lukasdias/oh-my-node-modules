//! Safety checks gating whether a `node_modules` directory may be deleted.
//!
//! Every check fails closed: any filesystem error reports the path as unsafe
//! rather than risking an unintended deletion.

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

/// Lockfiles whose recent modification marks a project as in use.
const LOCKFILES: &[&str] = &["package-lock.json", "yarn.lock", "pnpm-lock.yaml"];

/// Window within which a lockfile's mtime counts as "in use".
const IN_USE_WINDOW: Duration = Duration::from_secs(60);

/// Directory name a deletable path must have.
const NODE_MODULES: &str = "node_modules";

/// Project manifest marking a directory as a package root.
const PACKAGE_JSON: &str = "package.json";

/// Outcome of [`check`], in priority order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafetyCheck {
    /// The path is a valid `node_modules` directory safe to delete.
    Ok,
    /// The path's file name is not `node_modules`.
    NotNodeModules,
    /// The path does not exist.
    Missing,
    /// A lockfile in the project was modified within the in-use window.
    InUse,
    /// The path exists but is not a plausible `node_modules` directory.
    NotValid,
}

/// Whether `path` names a plausible `node_modules` directory.
///
/// The file name must be exactly `node_modules`, the path must exist and be a
/// real directory (a symlink to a directory is rejected), and it must contain
/// at least one child directory or sit next to a `package.json`.
///
/// Returns `false` on any filesystem error.
pub fn verify_nm(path: &Path) -> bool {
    if !has_node_modules_name(path) {
        return false;
    }

    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => {}
        _ => return false,
    }

    has_child_directory(path) || parent_has_package_json(path)
}

/// Whether any project lockfile was modified within 60 seconds of `now`.
///
/// Missing or unreadable lockfiles are ignored. A lockfile with a future mtime
/// counts as in use, so an unrepresentable or clock-skewed timestamp fails
/// closed.
pub fn is_in_use(project: &Path, now: SystemTime) -> bool {
    LOCKFILES.iter().any(|name| {
        let Ok(modified) = fs::metadata(project.join(name)).and_then(|meta| meta.modified()) else {
            return false;
        };
        match now.duration_since(modified) {
            Ok(elapsed) => elapsed <= IN_USE_WINDOW,
            Err(_) => true,
        }
    })
}

/// Classify `path` before deletion, in this order: name, existence, in-use
/// (when `check_in_use`), then [`verify_nm`].
pub fn check(path: &Path, check_in_use: bool, now: SystemTime) -> SafetyCheck {
    if !has_node_modules_name(path) {
        return SafetyCheck::NotNodeModules;
    }
    if !path.exists() {
        return SafetyCheck::Missing;
    }
    if check_in_use && path.parent().is_some_and(|parent| is_in_use(parent, now)) {
        return SafetyCheck::InUse;
    }
    if !verify_nm(path) {
        return SafetyCheck::NotValid;
    }
    SafetyCheck::Ok
}

/// Whether `path`'s final component is exactly `node_modules`.
fn has_node_modules_name(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()) == Some(NODE_MODULES)
}

/// Whether `path` contains at least one direct child directory.
fn has_child_directory(path: &Path) -> bool {
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };
    entries.flatten().any(|entry| entry.path().is_dir())
}

/// Whether the directory containing `path` holds a `package.json`.
fn parent_has_package_json(path: &Path) -> bool {
    path.parent()
        .is_some_and(|parent| parent.join(PACKAGE_JSON).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::SystemTime;

    #[test]
    fn verify_accepts_real_node_modules_with_subdir() {
        let tmp = tempfile::tempdir().unwrap();
        let nm = tmp.path().join("node_modules");
        fs::create_dir_all(nm.join("react")).unwrap();
        assert!(verify_nm(&nm));
    }

    #[test]
    fn verify_accepts_empty_node_modules_when_parent_has_package_json() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("package.json"), "{}").unwrap();
        let nm = tmp.path().join("node_modules");
        fs::create_dir(&nm).unwrap();
        assert!(verify_nm(&nm));
    }

    #[test]
    fn verify_rejects_fake_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let fake = tmp.path().join("not_node_modules");
        fs::create_dir(&fake).unwrap();
        assert!(!verify_nm(&fake));
    }

    #[test]
    fn check_flags_wrong_name() {
        let tmp = tempfile::tempdir().unwrap();
        let foo = tmp.path().join("foo");
        fs::create_dir(&foo).unwrap();
        assert_eq!(
            check(&foo, false, SystemTime::now()),
            SafetyCheck::NotNodeModules
        );
    }

    #[test]
    fn check_flags_missing_path() {
        let tmp = tempfile::tempdir().unwrap();
        let nm = tmp.path().join("node_modules");
        assert_eq!(check(&nm, false, SystemTime::now()), SafetyCheck::Missing);
    }

    #[test]
    fn check_flags_in_use_from_recent_lockfile() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("package-lock.json"), "{}").unwrap();
        let nm = tmp.path().join("node_modules");
        fs::create_dir(&nm).unwrap();

        let now = SystemTime::now();
        assert!(is_in_use(tmp.path(), now));
        assert_eq!(check(&nm, true, now), SafetyCheck::InUse);
    }

    #[cfg(unix)]
    #[test]
    fn check_rejects_node_modules_that_is_a_symlink() {
        use std::os::unix::fs::symlink;

        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("real");
        fs::create_dir_all(real.join("react")).unwrap();
        let nm = tmp.path().join("node_modules");
        symlink(&real, &nm).unwrap();

        assert_ne!(check(&nm, false, SystemTime::now()), SafetyCheck::Ok);
    }
}
