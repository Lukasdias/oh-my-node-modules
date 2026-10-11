use std::fs;
use std::path::Path;

use assert_cmd::Command;
use predicates::prelude::PredicateBooleanExt;
use predicates::str::contains;
use tempfile::{TempDir, tempdir};

/// Write `contents` to `path`, creating parent directories.
fn write_file(path: &Path, contents: &[u8]) {
    fs::create_dir_all(path.parent().expect("parent directory")).expect("create parent");
    fs::write(path, contents).expect("write file");
}

/// A root with two populated projects and one empty `node_modules`.
///
/// Layout: `pkgA/node_modules/a/f.js`, `pkgB/node_modules/b/g.js`, and an
/// empty `empty-parent/node_modules`.
fn fixture() -> TempDir {
    let root = tempdir().expect("tempdir");
    write_file(&root.path().join("pkgA/node_modules/a/f.js"), b"a");
    write_file(&root.path().join("pkgB/node_modules/b/g.js"), b"b");
    fs::create_dir_all(root.path().join("empty-parent/node_modules")).expect("create empty");
    root
}

#[test]
fn version_flag_prints_name_and_version() {
    Command::cargo_bin("onm")
        .unwrap()
        .arg("--version")
        .assert()
        .success()
        .stdout(contains("0.1.0"));
}

#[test]
fn help_lists_scan_and_auto_modes() {
    Command::cargo_bin("onm")
        .unwrap()
        .arg("--help")
        .assert()
        .success()
        .stdout(contains("--scan").and(contains("--auto")));
}

#[test]
fn scan_json_emits_an_array_of_projects() {
    let root = fixture();
    let output = Command::cargo_bin("onm")
        .unwrap()
        .args(["--scan", "--json"])
        .arg(root.path())
        .output()
        .expect("run onm");

    assert!(
        output.status.success(),
        "onm should exit 0, stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).expect("stdout is JSON");
    let projects = value.as_array().expect("top-level array");
    assert!(
        projects.len() >= 2,
        "expected at least 2 projects, got {}",
        projects.len()
    );
}

#[test]
fn scan_table_prints_totals() {
    let root = fixture();
    Command::cargo_bin("onm")
        .unwrap()
        .arg("--scan")
        .arg(root.path())
        .assert()
        .success()
        .stdout(contains("Total"));
}

#[test]
fn auto_dry_run_deletes_nothing() {
    let root = fixture();
    let pkg_a = root.path().join("pkgA/node_modules");
    let pkg_b = root.path().join("pkgB/node_modules");

    Command::cargo_bin("onm")
        .unwrap()
        .args(["--auto", "--dry-run", "--yes"])
        .arg(root.path())
        .assert()
        .success()
        .stdout(contains("[DRY RUN]"));

    assert!(pkg_a.exists(), "dry run must not delete pkgA/node_modules");
    assert!(pkg_b.exists(), "dry run must not delete pkgB/node_modules");
}

#[test]
fn auto_with_min_size_skips_small_targets() {
    let root = fixture();
    Command::cargo_bin("onm")
        .unwrap()
        .args(["--auto", "--min-size", "1gb", "--dry-run", "--yes"])
        .arg(root.path())
        .assert()
        .success()
        .stdout(contains("Nothing matched"));
}

#[test]
fn auto_json_emits_parseable_result() {
    let root = fixture();
    let pkg_a = root.path().join("pkgA/node_modules");
    let pkg_b = root.path().join("pkgB/node_modules");

    let output = Command::cargo_bin("onm")
        .unwrap()
        .args(["--auto", "--json", "--dry-run", "--yes"])
        .arg(root.path())
        .output()
        .expect("run onm");

    assert!(
        output.status.success(),
        "onm should exit 0, stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("stdout must be exactly one JSON document");
    assert!(value.is_object(), "result must be a JSON object");
    assert!(
        value
            .get("total_attempted")
            .is_some_and(serde_json::Value::is_number),
        "total_attempted must be a number, got: {value}"
    );
    assert!(pkg_a.exists(), "dry run must not delete pkgA/node_modules");
    assert!(pkg_b.exists(), "dry run must not delete pkgB/node_modules");
}

#[test]
fn invalid_min_size_exits_nonzero() {
    let root = fixture();
    Command::cargo_bin("onm")
        .unwrap()
        .args(["--auto", "--min-size", "banana"])
        .arg(root.path())
        .assert()
        .failure()
        .stderr(contains("banana"));
}

#[test]
fn nonexistent_root_exits_nonzero() {
    Command::cargo_bin("onm")
        .unwrap()
        .args(["--scan", "/definitely/not/here"])
        .assert()
        .failure();
}
