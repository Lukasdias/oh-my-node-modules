//! Loading of `.onmignore` exclude patterns and `.onmfavorites` favorites.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use globset::{Glob, GlobSet, GlobSetBuilder};

/// Default exclude glob patterns applied before any `.onmignore` entries.
const DEFAULT_EXCLUDES: &[&str] = &["**/node_modules/**", "**/.git/**", "**/.*"];

/// Name of the ignore file, looked up in `cwd` and then `home`.
const IGNORE_FILE: &str = ".onmignore";

/// Name of the favorites file, resolved relative to the home directory.
const FAVORITES_FILE: &str = ".onmfavorites";

/// Resolved ignore and favorites configuration.
#[derive(Debug)]
pub struct Config {
    /// Compiled glob set of paths to skip during discovery.
    pub exclude: GlobSet,
    /// Absolute paths marked as favorites.
    pub favorites: HashSet<PathBuf>,
}

/// The default exclude patterns, before any `.onmignore` entries.
pub fn default_excludes() -> &'static [&'static str] {
    DEFAULT_EXCLUDES
}

/// Load configuration from `cwd` and `home`.
///
/// `.onmignore` is read from `cwd` first, then `home`, and its non-blank,
/// non-comment lines are appended to [`default_excludes`]. `.onmfavorites` is
/// read from `home` only, one path per line. Missing or unreadable files are
/// treated as empty; invalid glob patterns are skipped.
pub fn load(cwd: &Path, home: Option<&Path>) -> Config {
    let mut builder = GlobSetBuilder::new();
    for pattern in DEFAULT_EXCLUDES {
        add_glob(&mut builder, pattern);
    }
    for dir in [Some(cwd), home].into_iter().flatten() {
        for pattern in read_lines(&dir.join(IGNORE_FILE)) {
            add_glob(&mut builder, &pattern);
        }
    }
    let exclude = builder.build().unwrap_or_else(|_| GlobSet::empty());

    let favorites = home
        .map(|dir| read_lines(&dir.join(FAVORITES_FILE)))
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect();

    Config { exclude, favorites }
}

/// Whether `path` (or one of its ancestors) matches a configured exclude.
///
/// The default patterns end in `/**`, which matches a directory's contents but
/// not the directory itself; matching each ancestor covers both the directory
/// and everything beneath it.
pub fn is_excluded(config: &Config, path: &Path) -> bool {
    is_excluded_by(&config.exclude, path)
}

/// Whether `path` (or one of its ancestors) matches a compiled exclude set.
///
/// The [`GlobSet`] form of [`is_excluded`], for callers that hold a compiled
/// set rather than a whole [`Config`] (such as `scan::discovery`).
pub fn is_excluded_by(exclude: &GlobSet, path: &Path) -> bool {
    path.ancestors()
        .any(|ancestor| !ancestor.as_os_str().is_empty() && exclude.is_match(ancestor))
}

/// Add `pattern` to `builder`, ignoring patterns that fail to compile.
///
/// A `foo/**` pattern matches the contents of `foo` but not `foo` itself, so
/// the directory form (the pattern with its trailing `/**` removed) is added
/// too. This makes a directory such as `node_modules` match directly.
fn add_glob(builder: &mut GlobSetBuilder, pattern: &str) {
    if let Ok(glob) = Glob::new(pattern) {
        builder.add(glob);
    }
    if let Some(dir) = pattern.strip_suffix("/**") {
        if let Ok(glob) = Glob::new(dir) {
            builder.add(glob);
        }
    }
}

/// Read non-blank, non-comment lines from `path`, or empty when unreadable.
fn read_lines(path: &Path) -> Vec<String> {
    let Ok(contents) = fs::read_to_string(path) else {
        return Vec::new();
    };
    contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn default_excludes_cover_node_modules_and_git() {
        let cfg = load(Path::new("/nonexistent-cwd"), None);
        assert!(is_excluded(&cfg, Path::new("/x/node_modules")));
        assert!(is_excluded(&cfg, Path::new("/x/.git/config")));
        assert!(!is_excluded(&cfg, Path::new("/x/src/index.ts")));
    }

    #[test]
    fn onmignore_adds_patterns() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".onmignore"), "# comment\n\n**/dist/**\n").unwrap();
        let cfg = load(dir.path(), None);
        assert!(is_excluded(&cfg, &dir.path().join("dist/bundle.js")));
    }

    #[test]
    fn favorites_reads_one_path_per_line() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(home.path().join(".onmfavorites"), "# comment\n\n/a/b\n").unwrap();
        let cfg = load(Path::new("/nonexistent-cwd"), Some(home.path()));
        assert!(cfg.favorites.contains(Path::new("/a/b")));
        assert_eq!(cfg.favorites.len(), 1);
    }
}
