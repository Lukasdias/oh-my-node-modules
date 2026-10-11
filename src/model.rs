//! Domain types describing a discovered `node_modules` directory.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serializer;

/// Largest byte count still considered [`SizeCategory::Small`] (100 MiB).
pub const SIZE_SMALL_MAX: u64 = 104_857_600;
/// Largest byte count still considered [`SizeCategory::Medium`] (500 MiB).
pub const SIZE_MEDIUM_MAX: u64 = 524_288_000;
/// Largest byte count still considered [`SizeCategory::Large`] (1 GiB).
pub const SIZE_LARGE_MAX: u64 = 1_073_741_824;

/// Largest age in days still considered [`AgeCategory::Fresh`].
pub const AGE_FRESH_DAYS: u64 = 7;
/// Largest age in days still considered [`AgeCategory::Recent`].
pub const AGE_RECENT_DAYS: u64 = 30;
/// Largest age in days still considered [`AgeCategory::Old`].
pub const AGE_OLD_DAYS: u64 = 90;

/// Whole seconds in a day.
const SECS_PER_DAY: u64 = 86_400;

/// Coarse size bucket derived from a directory's byte count.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum SizeCategory {
    /// At most [`SIZE_SMALL_MAX`] bytes.
    Small,
    /// More than [`SIZE_SMALL_MAX`], at most [`SIZE_MEDIUM_MAX`] bytes.
    Medium,
    /// More than [`SIZE_MEDIUM_MAX`], at most [`SIZE_LARGE_MAX`] bytes.
    Large,
    /// More than [`SIZE_LARGE_MAX`] bytes.
    Huge,
}

/// Coarse age bucket derived from a directory's last modification time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum AgeCategory {
    /// At most [`AGE_FRESH_DAYS`] days old.
    Fresh,
    /// More than [`AGE_FRESH_DAYS`], at most [`AGE_RECENT_DAYS`] days old.
    Recent,
    /// More than [`AGE_RECENT_DAYS`], at most [`AGE_OLD_DAYS`] days old.
    Old,
    /// More than [`AGE_OLD_DAYS`] days old.
    Stale,
}

/// Serialize a [`SystemTime`] as unix epoch milliseconds.
///
/// Times before the epoch (or otherwise unrepresentable) serialize as `0`.
/// Used through `#[serde(serialize_with = ...)]`; not called directly.
pub mod serde_unix_ms {
    use super::{Serializer, SystemTime, UNIX_EPOCH};

    /// Write `time` as a `u64` count of milliseconds since the unix epoch.
    pub fn serialize<S>(time: &SystemTime, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let millis = time.duration_since(UNIX_EPOCH).ok().map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        });
        serializer.serialize_u64(millis)
    }
}

/// Bucket `bytes` into a [`SizeCategory`].
///
/// Boundaries are inclusive upper bounds: exactly [`SIZE_SMALL_MAX`] is
/// [`SizeCategory::Small`], while one byte more is [`SizeCategory::Medium`].
pub fn size_category(bytes: u64) -> SizeCategory {
    if bytes <= SIZE_SMALL_MAX {
        SizeCategory::Small
    } else if bytes <= SIZE_MEDIUM_MAX {
        SizeCategory::Medium
    } else if bytes <= SIZE_LARGE_MAX {
        SizeCategory::Large
    } else {
        SizeCategory::Huge
    }
}

/// Whole days between `modified` and `now`, or `0` when `modified` is in the
/// future or otherwise unrepresentable.
pub fn age_in_days(modified: SystemTime, now: SystemTime) -> u64 {
    now.duration_since(modified)
        .map_or(0, |elapsed| elapsed.as_secs() / SECS_PER_DAY)
}

/// Bucket the age of `modified` relative to `now` into an [`AgeCategory`].
pub fn age_category(modified: SystemTime, now: SystemTime) -> AgeCategory {
    let days = age_in_days(modified, now);
    if days <= AGE_FRESH_DAYS {
        AgeCategory::Fresh
    } else if days <= AGE_RECENT_DAYS {
        AgeCategory::Recent
    } else if days <= AGE_OLD_DAYS {
        AgeCategory::Old
    } else {
        AgeCategory::Stale
    }
}

/// A discovered `node_modules` directory and its derived metadata.
///
/// `last_modified` is not natively serializable; it is emitted as the
/// `last_modified_ms` unix-epoch-milliseconds integer via [`serde_unix_ms`].
#[derive(Debug, Clone, serde::Serialize)]
pub struct NodeModulesInfo {
    /// Absolute path to the `node_modules` directory.
    pub path: PathBuf,
    /// Directory containing the owning `package.json` (may equal `path`'s parent).
    pub project_path: PathBuf,
    /// Project name from `package.json`, or the directory name as fallback.
    pub project_name: String,
    /// Version from `package.json`, when present.
    pub project_version: Option<String>,
    /// Nearest ancestor directory containing a `.git` entry.
    pub repo_path: PathBuf,
    /// Total size of the directory tree in bytes.
    pub size_bytes: u64,
    /// Number of direct child packages counted in `size_bytes`.
    pub package_count: u64,
    /// Number of packages including nested (transitive) installs.
    pub total_package_count: u64,
    /// Last modification time of the directory.
    #[serde(
        serialize_with = "serde_unix_ms::serialize",
        rename = "last_modified_ms"
    )]
    pub last_modified: SystemTime,
    /// Whether the item is selected for deletion in the interactive UI.
    pub selected: bool,
    /// Whether the path matches a configured favorite.
    pub is_favorite: bool,
    /// Size bucket derived from `size_bytes`.
    pub size_category: SizeCategory,
    /// Age bucket derived from `last_modified`.
    pub age_category: AgeCategory,
    /// Whether deletion of this item is currently in progress.
    pub is_pending: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    #[test]
    fn size_category_at_thresholds() {
        assert_eq!(size_category(104_857_600), SizeCategory::Small);
        assert_eq!(size_category(104_857_601), SizeCategory::Medium);
        assert_eq!(size_category(107_374_182_400), SizeCategory::Huge);
    }

    #[test]
    fn age_category_at_thresholds() {
        let now = SystemTime::now();
        let days = |d: u64| now - Duration::from_secs(86_400 * d);
        assert_eq!(age_category(days(7), now), AgeCategory::Fresh);
        assert_eq!(age_category(days(8), now), AgeCategory::Recent);
        assert_eq!(age_category(days(91), now), AgeCategory::Stale);
    }

    #[test]
    fn node_modules_info_serializes_timestamp_as_ms() {
        let last_modified_ms: u64 = 1_700_000_000_000;
        let last_modified = SystemTime::UNIX_EPOCH + Duration::from_millis(last_modified_ms);
        let info = NodeModulesInfo {
            path: PathBuf::from("/repo/node_modules"),
            project_path: PathBuf::from("/repo"),
            project_name: "demo".to_string(),
            project_version: Some("2.1.0".to_string()),
            repo_path: PathBuf::from("/repo"),
            size_bytes: 1024,
            package_count: 3,
            total_package_count: 3,
            last_modified,
            selected: false,
            is_favorite: false,
            size_category: SizeCategory::Small,
            age_category: AgeCategory::Fresh,
            is_pending: false,
        };

        let value = serde_json::to_value(&info).expect("serialize");
        let key = value.get("last_modified_ms").expect("last_modified_ms key");
        assert_eq!(key.as_u64(), Some(last_modified_ms));
    }
}
