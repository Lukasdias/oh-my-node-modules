use assert_cmd::Command;
use predicates::prelude::PredicateBooleanExt;
use predicates::str::contains;

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
