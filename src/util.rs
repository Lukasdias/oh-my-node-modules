//! Pure formatting and parsing helpers shared across the crate.

use std::fmt;
use std::io::Write;
use std::time::SystemTime;

/// Base for binary size units.
const UNIT: u64 = 1024;

/// One kibibyte in bytes.
pub const KB: u64 = UNIT;
/// One mebibyte in bytes.
pub const MB: u64 = UNIT * UNIT;
/// One gibibyte in bytes.
pub const GB: u64 = UNIT * UNIT * UNIT;
/// One tebibyte in bytes.
pub const TB: u64 = UNIT * UNIT * UNIT * UNIT;

const MINUTE: u64 = 60;
const HOUR: u64 = 60 * MINUTE;
const DAY: u64 = 24 * HOUR;
// Approximate calendar units for human-friendly age buckets.
const MONTH: u64 = 30 * DAY;
const YEAR: u64 = 365 * DAY;

/// Format a byte count with binary units.
///
/// Values below a mebibyte are shown as whole numbers (`0 B`, `1 KB`);
/// mebibytes and above use one decimal place (`1.0 MB`, `1.5 GB`).
pub fn format_bytes(bytes: u64) -> String {
    if bytes >= TB {
        format!("{:.1} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{} KB", bytes / KB)
    } else {
        format!("{bytes} B")
    }
}

/// Write a line to stdout, ignoring a broken pipe (`EPIPE`) instead of panicking.
///
/// `println!` panics when the reader closes the pipe early (for example
/// `onm --scan . | head`), which would violate the crate's "no panics on
/// runtime paths" constraint. This discards any write error so a truncated
/// consumer never aborts the process.
pub fn write_line(line: &str) {
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    let _ = writeln!(lock, "{line}");
}

/// Error returned when [`parse_size`] cannot parse its input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseSizeError {
    input: String,
}

impl fmt::Display for ParseSizeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid size {:?}: expected a non-negative number with an optional b/kb/mb/gb/tb suffix",
            self.input
        )
    }
}

impl std::error::Error for ParseSizeError {}

/// Parse a human-readable size such as `500mb`, `1 GB`, or `1024`.
///
/// The suffix (`b`, `kb`, `mb`, `gb`, `tb`) is case-insensitive, may be
/// separated by whitespace, and may be omitted for a raw byte count. A
/// fractional number is accepted and rounded to the nearest byte. Empty,
/// non-numeric, and negative inputs return an error.
pub fn parse_size(s: &str) -> Result<u64, ParseSizeError> {
    let invalid = || ParseSizeError {
        input: s.to_string(),
    };

    let trimmed = s.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return Err(invalid());
    }

    // Split the leading numeric run from the trailing unit suffix.
    let split = trimmed
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(trimmed.len());
    let (number_part, suffix_part) = trimmed.split_at(split);
    if number_part.is_empty() {
        return Err(invalid());
    }

    let number: f64 = number_part.parse().map_err(|_| invalid())?;
    if !number.is_finite() || number < 0.0 {
        return Err(invalid());
    }

    let unit = match suffix_part.trim().to_ascii_lowercase().as_str() {
        "" | "b" => 1,
        "kb" => KB,
        "mb" => MB,
        "gb" => GB,
        "tb" => TB,
        _ => return Err(invalid()),
    };

    let bytes = number * unit as f64;
    if !bytes.is_finite() || bytes > u64::MAX as f64 {
        return Err(invalid());
    }
    Ok(bytes.round() as u64)
}

/// Render the age of `modified` relative to `now`, e.g. `"5h ago"`.
///
/// Buckets: `just now` (under a minute), then whole minutes, hours, days,
/// months (30 days), and years (365 days). A `modified` in the future is
/// treated as `just now`.
pub fn format_relative_time(modified: SystemTime, now: SystemTime) -> String {
    let elapsed = match now.duration_since(modified) {
        Ok(elapsed) => elapsed,
        Err(_) => return "just now".to_string(),
    };
    let secs = elapsed.as_secs();

    if secs < MINUTE {
        "just now".to_string()
    } else if secs < HOUR {
        format!("{}m ago", secs / MINUTE)
    } else if secs < DAY {
        format!("{}h ago", secs / HOUR)
    } else if secs < MONTH {
        format!("{}d ago", secs / DAY)
    } else if secs < YEAR {
        format!("{}mo ago", secs / MONTH)
    } else {
        format!("{}y ago", secs / YEAR)
    }
}

/// Truncate `s` to at most `max` characters, appending `...` when shortened.
///
/// When `max <= 3` there is no room for the ellipsis, so the input is cut to
/// `max` characters with no marker. Operates on characters, not bytes.
pub fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    if max <= 3 {
        return s.chars().take(max).collect();
    }
    let mut out: String = s.chars().take(max - 3).collect();
    out.push_str("...");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    #[test]
    fn format_bytes_boundaries() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(1024), "1 KB");
        assert_eq!(format_bytes(1024 * 1024), "1.0 MB");
        assert_eq!(format_bytes(1024 * 1024 * 1024), "1.0 GB");
    }

    #[test]
    fn parse_size_roundtrips_units() {
        assert_eq!(parse_size("1gb").unwrap(), 1_073_741_824);
        assert_eq!(parse_size("500MB").unwrap(), 524_288_000);
        assert_eq!(parse_size("1024").unwrap(), 1024);
        assert!(parse_size("banana").is_err());
        assert!(parse_size("-5mb").is_err());
    }

    #[test]
    fn relative_time_buckets() {
        let now = SystemTime::now();
        assert_eq!(format_relative_time(now, now), "just now");
        assert_eq!(
            format_relative_time(now - Duration::from_secs(3600 * 5), now),
            "5h ago"
        );
        assert_eq!(
            format_relative_time(now - Duration::from_secs(86400 * 3), now),
            "3d ago"
        );
    }

    #[test]
    fn truncate_handles_paths_with_spaces() {
        assert_eq!(truncate("a very long path with spaces", 10), "a very ...");
        assert_eq!(truncate("short", 10), "short");
    }
}
