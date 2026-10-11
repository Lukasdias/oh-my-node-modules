//! Interactive selection: sorting, the `inquire` multi-select, and confirmation.

use std::fmt;
use std::time::SystemTime;

use inquire::{Confirm, MultiSelect};

use crate::cli::SortArg;
use crate::model::NodeModulesInfo;
use crate::ui::theme;
use crate::util::{format_bytes, format_relative_time};

/// Prompt shown above the multi-select.
const SELECT_MESSAGE: &str = "Select directories to delete (space to toggle, enter to confirm):";

/// One row of the picker: its position in the input slice and its rendered label.
///
/// Wrapping the index in a [`Display`] type lets [`MultiSelect::prompt`] return
/// the selected rows directly, so the caller gets indices without re-matching
/// on rendered strings.
struct Row {
    index: usize,
    label: String,
}

impl fmt::Display for Row {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.label)
    }
}

/// Sort `items` in place by `sort`, reversing when `ascending` is false.
///
/// Key meanings (ascending): size smallest first, date oldest first, name
/// A-to-Z case-insensitively, packages fewest first. Descending is the reverse,
/// so `SortArg::Size` with `ascending == false` puts the largest first.
pub fn sort_items(items: &mut [NodeModulesInfo], sort: SortArg, ascending: bool) {
    items.sort_by(|a, b| {
        let ordering = match sort {
            SortArg::Size => a.size_bytes.cmp(&b.size_bytes),
            SortArg::Date => a.last_modified.cmp(&b.last_modified),
            SortArg::Name => a
                .project_name
                .to_lowercase()
                .cmp(&b.project_name.to_lowercase()),
            SortArg::Packages => a.total_package_count.cmp(&b.total_package_count),
        };
        if ascending {
            ordering
        } else {
            ordering.reverse()
        }
    });
}

/// Present a multi-select of `items` and return the chosen indices.
///
/// Each option renders as `[size]  project  [age]  repo_path` with the size and
/// age colored by [`theme`]. Favorites are deselected by default; every other
/// item starts selected. Returns `None` when the prompt is cancelled or errors.
pub fn pick(items: &[NodeModulesInfo]) -> Option<Vec<usize>> {
    if items.is_empty() {
        return Some(Vec::new());
    }

    let now = SystemTime::now();
    let mut default_indices = Vec::new();
    let rows: Vec<Row> = items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            if !item.is_favorite {
                default_indices.push(index);
            }
            Row {
                index,
                label: row_label(item, now),
            }
        })
        .collect();

    MultiSelect::new(SELECT_MESSAGE, rows)
        .with_default(&default_indices)
        .prompt()
        .ok()
        .map(|selected| selected.into_iter().map(|row| row.index).collect())
}

/// Ask a yes/no question, returning `false` when the prompt is cancelled or errors.
pub fn confirm(message: &str) -> bool {
    Confirm::new(message)
        .with_default(false)
        .prompt()
        .unwrap_or(false)
}

/// Render one picker row: `[size]  project  [age]  repo_path`.
fn row_label(item: &NodeModulesInfo, now: SystemTime) -> String {
    let size = theme::paint(
        theme::size_color(item.size_category),
        &format!("[{}]", format_bytes(item.size_bytes)),
    );
    let age = theme::paint(
        theme::age_color(item.age_category),
        &format!("[{}]", format_relative_time(item.last_modified, now)),
    );
    format!(
        "{size}  {}  {age}  {}",
        item.project_name,
        item.repo_path.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::SortArg;
    use crate::model::NodeModulesInfo;
    use std::path::PathBuf;
    use std::time::{Duration, SystemTime};

    /// A minimal item carrying only the fields the sort keys read.
    fn item(name: &str, size: u64) -> NodeModulesInfo {
        NodeModulesInfo {
            path: PathBuf::from(format!("/{name}/node_modules")),
            project_path: PathBuf::from(format!("/{name}")),
            project_name: name.to_string(),
            project_version: None,
            repo_path: PathBuf::from(format!("/{name}")),
            size_bytes: size,
            package_count: 0,
            total_package_count: 0,
            last_modified: SystemTime::UNIX_EPOCH + Duration::from_secs(size),
            selected: false,
            is_favorite: false,
            size_category: crate::model::size_category(size),
            age_category: crate::model::AgeCategory::Fresh,
            is_pending: false,
        }
    }

    /// Byte sizes in current order.
    fn sizes(items: &[NodeModulesInfo]) -> Vec<u64> {
        items.iter().map(|item| item.size_bytes).collect()
    }

    #[test]
    fn sort_items_by_size_respects_direction() {
        let mut items = vec![item("a", 1), item("b", 2), item("c", 3)];

        sort_items(&mut items, SortArg::Size, false);
        assert_eq!(sizes(&items), vec![3, 2, 1]);

        sort_items(&mut items, SortArg::Size, true);
        assert_eq!(sizes(&items), vec![1, 2, 3]);
    }

    #[test]
    fn sort_items_by_name_is_case_insensitive() {
        let mut items = vec![item("beta", 0), item("Alpha", 0), item("gamma", 0)];

        sort_items(&mut items, SortArg::Name, true);
        let names: Vec<&str> = items.iter().map(|i| i.project_name.as_str()).collect();
        assert_eq!(names, ["Alpha", "beta", "gamma"]);
    }

    #[test]
    fn sort_items_by_date_and_packages_respect_direction() {
        let mut items = vec![item("a", 1), item("b", 2), item("c", 3)];
        // package_count is 0 for every item; set distinct totals to sort by.
        for (index, item) in items.iter_mut().enumerate() {
            item.total_package_count = (index as u64 + 1) * 10;
        }

        sort_items(&mut items, SortArg::Date, false);
        assert_eq!(sizes(&items), vec![3, 2, 1]);

        sort_items(&mut items, SortArg::Packages, true);
        let totals: Vec<u64> = items.iter().map(|i| i.total_package_count).collect();
        assert_eq!(totals, vec![10, 20, 30]);
    }
}
