//! Table and JSON rendering of scan results.

use std::path::Path;
use std::time::SystemTime;

use crate::model::{AgeCategory, NodeModulesInfo, age_category};
use crate::scan::ScanOutcome;
use crate::ui::theme;
use crate::util::{format_bytes, format_relative_time};

/// Print at most `limit` rows to stdout as
/// `[size]  project_name  [age]  repo_path`.
///
/// Size and age tokens are colored by [`theme`]; the size uses the item's
/// [`SizeCategory`](crate::model::SizeCategory) and the age is rendered
/// relative to `now`. When more items exist than `limit`, a trailing
/// `... and N more` line reports the remainder. Paths are shown relative to
/// `cwd` when they live beneath it.
pub fn print_table(items: &[NodeModulesInfo], limit: usize, now: SystemTime, cwd: &Path) {
    let shown = items.len().min(limit);
    for item in &items[..shown] {
        let size = theme::paint(
            theme::size_color(item.size_category),
            &format!("[{}]", format_bytes(item.size_bytes)),
        );
        let age = theme::paint(
            theme::age_color(item.age_category),
            &format!("[{}]", format_relative_time(item.last_modified, now)),
        );
        let name = item.project_name.as_str();
        let path = show_path(&item.repo_path, cwd);
        println!("{size}  {name}  {age}  {path}");
    }

    if items.len() > limit {
        println!("... and {} more", items.len() - limit);
    }
}

/// Serialize `value` as a pretty-printed JSON document.
///
/// Used for the scan array (`&[NodeModulesInfo]`) and the deletion result
/// (`&DeletionResult`); any [`serde::Serialize`] value is accepted.
pub fn to_json<T: serde::Serialize>(value: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(value)
}

/// One-line totals for a scan: total size, project count, and stale count.
///
/// An item counts as stale when [`age_category`] buckets its last
/// modification older than the stale threshold relative to `now`.
pub fn summary_line(outcome: &ScanOutcome, now: SystemTime) -> String {
    let items = &outcome.node_modules;
    let total_bytes: u64 = items.iter().map(|item| item.size_bytes).sum();
    let stale = items
        .iter()
        .filter(|item| age_category(item.last_modified, now) == AgeCategory::Stale)
        .count();
    let projects = if items.len() == 1 {
        "project"
    } else {
        "projects"
    };
    format!(
        "{} {projects}, {} total, {} stale",
        items.len(),
        format_bytes(total_bytes),
        stale
    )
}

/// Render `path` relative to `cwd` when it is a descendant, else unchanged.
fn show_path(path: &Path, cwd: &Path) -> String {
    match path.strip_prefix(cwd) {
        Ok(relative) if relative.as_os_str().is_empty() => ".".to_string(),
        Ok(relative) => relative.display().to_string(),
        Err(_) => path.display().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime};

    use crate::model::{AgeCategory, NodeModulesInfo, SizeCategory};
    use crate::ui::report;

    /// A single item with predictable fields for shape assertions.
    fn sample() -> NodeModulesInfo {
        NodeModulesInfo {
            path: PathBuf::from("/repo/node_modules"),
            project_path: PathBuf::from("/repo"),
            project_name: "demo".to_string(),
            project_version: Some("1.0.0".to_string()),
            repo_path: PathBuf::from("/repo"),
            size_bytes: 2048,
            package_count: 3,
            total_package_count: 3,
            last_modified: SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000),
            selected: false,
            is_favorite: false,
            size_category: SizeCategory::Small,
            age_category: AgeCategory::Fresh,
            is_pending: false,
        }
    }

    #[test]
    fn to_json_serializes_an_array_with_path_and_size() {
        let values = report::to_json(&[sample()]).expect("serialize");
        let value: serde_json::Value = serde_json::from_str(&values).expect("valid json");

        assert!(value.is_array());
        assert!(value[0]["path"].is_string());
        assert!(value[0]["size_bytes"].is_number());
    }

    #[test]
    fn show_path_shortens_descendants_and_keeps_outsiders() {
        assert_eq!(
            report::show_path(Path::new("/work/app"), Path::new("/work")),
            "app"
        );
        assert_eq!(
            report::show_path(Path::new("/work"), Path::new("/work")),
            "."
        );
        assert_eq!(
            report::show_path(Path::new("/other/app"), Path::new("/work")),
            "/other/app"
        );
    }
}
