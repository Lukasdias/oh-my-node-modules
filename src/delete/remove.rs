//! Physical removal of `node_modules` directory trees.
//!
//! [`remove_fast`] is the single-shot path used on healthy trees.
//! [`remove_forced`] escalates through fallbacks for trees that refuse to go
//! away, such as ones holding read-only files or unwritable directories.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Removes `path` and everything beneath it with a single `remove_dir_all`.
pub fn remove_fast(path: &Path) -> io::Result<()> {
    fs::remove_dir_all(path)
}

/// Removes `path` and everything beneath it, escalating through fallbacks.
///
/// 1. [`remove_fast`].
/// 2. Make the tree writable, then retry — read-only files and unwritable
///    directories block the single-shot removal.
/// 3. Rename `path` aside to `<path>.old.<unix_ms>` and remove the renamed
///    tree, which sidesteps a stubborn original name.
///
/// Returns the error from the last strategy when every one fails.
pub fn remove_forced(path: &Path) -> io::Result<()> {
    if remove_fast(path).is_ok() {
        return Ok(());
    }

    if make_writable_recursive(path).is_ok() && remove_fast(path).is_ok() {
        return Ok(());
    }

    let moved = renamed_path(path, unix_millis());
    fs::rename(path, &moved).and_then(|()| fs::remove_dir_all(&moved))
}

/// Makes `path` and every descendant writable, without following symlinks.
fn make_writable_recursive(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path)? {
            make_writable_recursive(&entry?.path())?;
        }
    }
    set_writable(path)
}

/// Adds write permission to a single entry.
#[cfg(unix)]
fn set_writable(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o777))
}

/// Clears the read-only attribute on platforms without Unix modes.
#[cfg(not(unix))]
fn set_writable(path: &Path) -> io::Result<()> {
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_readonly(false);
    fs::set_permissions(path, permissions)
}

/// Builds the `<path>.old.<millis>` name used by the rename fallback.
fn renamed_path(path: &Path, millis: u128) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".old.{millis}"));
    PathBuf::from(name)
}

/// Milliseconds since the Unix epoch, or `0` if the clock predates it.
fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn remove_fast_deletes_a_tree() {
        let tmp = tempfile::tempdir().unwrap();
        let nm = tmp.path().join("node_modules");
        fs::create_dir_all(nm.join("react/lib")).unwrap();
        fs::write(nm.join("react/package.json"), "{}").unwrap();
        fs::write(nm.join("react/lib/index.js"), "x").unwrap();

        remove_fast(&nm).unwrap();

        assert!(!nm.exists());
    }

    #[test]
    fn remove_forced_deletes_a_tree() {
        let tmp = tempfile::tempdir().unwrap();
        let nm = tmp.path().join("node_modules");
        fs::create_dir_all(nm.join("react")).unwrap();
        fs::write(nm.join("react/index.js"), "x").unwrap();

        remove_forced(&nm).unwrap();

        assert!(!nm.exists());
    }

    /// A directory with no write permission cannot unlink its children, so
    /// `remove_fast` fails and `remove_forced` must recover by fixing
    /// permissions before retrying.
    #[cfg(unix)]
    #[test]
    fn remove_forced_recovers_from_unwritable_tree() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let nm = tmp.path().join("node_modules");
        fs::create_dir(&nm).unwrap();
        let locked = nm.join("locked.txt");
        fs::write(&locked, "x").unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o444)).unwrap();
        fs::set_permissions(&nm, fs::Permissions::from_mode(0o555)).unwrap();

        // The plain path must fail here, otherwise the test proves nothing.
        assert!(remove_fast(&nm).is_err());

        let result = remove_forced(&nm);

        // Restore permissions on anything left behind (the original path or a
        // renamed `.old.<ms>` sibling) so the tempdir can clean up before the
        // assertions below can panic.
        if let Ok(entries) = fs::read_dir(tmp.path()) {
            for entry in entries.flatten() {
                let _ = make_writable_recursive(&entry.path());
            }
        }

        assert!(result.is_ok(), "remove_forced failed: {result:?}");
        assert!(!nm.exists());
    }

    #[test]
    fn remove_forced_reports_error_when_path_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("node_modules");

        assert!(remove_fast(&missing).is_err());
        assert!(remove_forced(&missing).is_err());
        assert!(!missing.exists());
    }

    #[test]
    fn renamed_path_appends_old_marker_and_millis() {
        let path = std::path::Path::new("/tmp/node_modules");
        assert_eq!(
            renamed_path(path, 1_700_000_000_000),
            PathBuf::from("/tmp/node_modules.old.1700000000000")
        );
    }
}
