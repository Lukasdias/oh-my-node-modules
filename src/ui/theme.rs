//! ANSI color names for size and age categories.
//!
//! Colors are expressed as plain ANSI color names so tests can assert on the
//! mapping without depending on terminal color support.

use owo_colors::{AnsiColors, OwoColorize, Stream};

use crate::model::{AgeCategory, SizeCategory};

/// ANSI color name for a size bucket.
///
/// Larger directories are more alarming: `huge` red, `large` yellow,
/// `medium` cyan, `small` green.
pub fn size_color(category: SizeCategory) -> &'static str {
    match category {
        SizeCategory::Huge => "red",
        SizeCategory::Large => "yellow",
        SizeCategory::Medium => "cyan",
        SizeCategory::Small => "green",
    }
}

/// ANSI color name for an age bucket.
///
/// Older installs are more stale: `stale` gray, `old` yellow, `recent` cyan,
/// `fresh` green.
pub fn age_color(category: AgeCategory) -> &'static str {
    match category {
        AgeCategory::Stale => "gray",
        AgeCategory::Old => "yellow",
        AgeCategory::Recent => "cyan",
        AgeCategory::Fresh => "green",
    }
}

/// Map an ANSI color name to an `owo_colors` color, or `None` when unknown.
///
/// ANSI renders `gray` as "bright black", which is why the name and the
/// variant differ.
fn ansi_color(name: &str) -> Option<AnsiColors> {
    match name {
        "red" => Some(AnsiColors::Red),
        "yellow" => Some(AnsiColors::Yellow),
        "cyan" => Some(AnsiColors::Cyan),
        "green" => Some(AnsiColors::Green),
        "gray" => Some(AnsiColors::BrightBlack),
        _ => None,
    }
}

/// Wrap `text` in the ANSI color `name`.
///
/// Unknown names and streams that do not support color fall back to plain
/// `text`, so output stays readable when redirected or in a dumb terminal.
pub fn paint(name: &str, text: &str) -> String {
    match ansi_color(name) {
        Some(color) => text
            .if_supports_color(Stream::Stdout, |value| value.color(color).to_string())
            .to_string(),
        None => text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use crate::model::{AgeCategory, SizeCategory};
    use crate::ui::theme;

    #[test]
    fn theme_maps_huge_to_red_and_fresh_to_green() {
        assert_eq!(theme::size_color(SizeCategory::Huge), "red");
        assert_eq!(theme::age_color(AgeCategory::Fresh), "green");
    }
}
