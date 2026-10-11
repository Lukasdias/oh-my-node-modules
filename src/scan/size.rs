//! Directory size and package counting for a `node_modules` tree.

use std::fs;
use std::io;
use std::path::Path;

use ignore::WalkBuilder;

/// Aggregate size and package counts for a `node_modules` directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DirStats {
    /// Total size in bytes of every file beneath the root, hidden files
    /// included. Directory entries themselves contribute nothing.
    pub total_size: u64,
    /// Number of direct child package directories, excluding hidden entries
    /// and `.bin`.
    pub package_count: u64,
    /// Number of descendant package directories, excluding the root itself,
    /// hidden entries, and `.bin`.
    pub total_package_count: u64,
}

/// Whether a directory named `name` should be counted as a package.
///
/// Hidden entries (a leading `.`) and the npm `.bin` shim directory never
/// count; `.bin` is hidden already, but it is listed explicitly to match the
/// documented rule.
fn is_counted_package_name(name: &str) -> bool {
    !(name.starts_with('.') || name == ".bin")
}

/// Walk `dir` and accumulate its byte size and package counts.
///
/// Traversal is a plain directory walk: the `ignore` crate's gitignore,
/// `.ignore`, global, and parent-directory handling are all disabled, and
/// hidden entries are traversed (so their bytes count) rather than skipped.
/// Per-entry errors (unreadable files or directories) are skipped and the walk
/// continues; the root must exist and be a directory.
pub fn dir_stats(dir: &Path) -> io::Result<DirStats> {
    let metadata = fs::metadata(dir)?;
    if !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("not a directory: {}", dir.display()),
        ));
    }

    let walker = WalkBuilder::new(dir)
        .hidden(false)
        .ignore(false)
        .git_ignore(false)
        .git_global(false)
        .git_exclude(false)
        .parents(false)
        .build();

    let mut stats = DirStats {
        total_size: 0,
        package_count: 0,
        total_package_count: 0,
    };

    for entry in walker {
        // Unreadable entries surface as errors; skip them and keep counting.
        let Ok(entry) = entry else {
            continue;
        };

        // Depth 0 is `dir` itself, which is not a package and has no bytes.
        let depth = entry.depth();
        if depth == 0 {
            continue;
        }

        let Some(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            if is_counted_package_name(&entry.file_name().to_string_lossy()) {
                if depth == 1 {
                    stats.package_count += 1;
                }
                stats.total_package_count += 1;
            }
        } else if file_type.is_file() {
            match entry.metadata() {
                Ok(metadata) => stats.total_size += metadata.len(),
                Err(_) => continue,
            }
        }
    }

    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    /// Create a file of `bytes` zero bytes, making parent directories as needed.
    fn write(path: &Path, bytes: usize) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![0u8; bytes]).unwrap();
    }

    #[test]
    fn counts_size_and_packages() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("node_modules");
        write(&root.join("a/index.js"), 10);
        write(&root.join("b/package.json"), 5);
        write(&root.join(".cache/x"), 3);
        write(&root.join(".bin/y"), 2);

        let stats = dir_stats(&root).unwrap();
        assert_eq!(stats.total_size, 20);
        assert_eq!(stats.package_count, 2);
        assert_eq!(stats.total_package_count, 2);
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_subdirectory_is_skipped() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("node_modules");
        write(&root.join("a/index.js"), 10);
        write(&root.join("b/package.json"), 5);

        let locked = root.join("b");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();

        let stats = dir_stats(&root).unwrap();
        // Restore before asserting so the tempdir can be cleaned up on failure.
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(stats.total_size, 10);
        assert_eq!(stats.package_count, 2);
        assert_eq!(stats.total_package_count, 2);
    }
}
