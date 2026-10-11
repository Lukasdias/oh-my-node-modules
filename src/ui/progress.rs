//! A spinner driven by [`ScanProgress`] updates.

use std::time::Duration;

use indicatif::{ProgressBar, ProgressStyle};

use crate::scan::{Phase, ScanProgress};

/// Time between spinner re-draws.
const TICK_INTERVAL: Duration = Duration::from_millis(100);

/// An `indicatif` spinner fed from a scan's progress callback.
///
/// The bar draws to stderr; [`indicatif`] suppresses rendering when stderr is
/// not a terminal, so no terminal check is needed here.
pub struct ScanSpinner {
    bar: ProgressBar,
}

impl ScanSpinner {
    /// Create a spinner with the default spinner style, ticking steadily.
    pub fn new() -> Self {
        let bar = ProgressBar::new_spinner();
        bar.set_style(ProgressStyle::default_spinner());
        bar.enable_steady_tick(TICK_INTERVAL);
        Self { bar }
    }

    /// Update the spinner message from a progress snapshot.
    pub fn update(&self, progress: ScanProgress) {
        let message = match progress.phase {
            Phase::Discovering => format!("Scanning... found {}", progress.done),
            Phase::Sizing => {
                format!("Calculating sizes... {}/{}", progress.done, progress.total)
            }
            Phase::Done => return,
        };
        self.bar.set_message(message);
    }

    /// Stop the spinner and leave `message` on screen.
    pub fn finish(&self, message: &str) {
        self.bar.finish_with_message(message.to_string());
    }
}

impl Default for ScanSpinner {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_does_not_panic_for_each_phase() {
        let spinner = ScanSpinner::new();
        for progress in [
            ScanProgress {
                phase: Phase::Discovering,
                done: 3,
                total: 0,
            },
            ScanProgress {
                phase: Phase::Sizing,
                done: 1,
                total: 4,
            },
            ScanProgress {
                phase: Phase::Done,
                done: 4,
                total: 4,
            },
        ] {
            spinner.update(progress);
        }
        spinner.finish("Scan complete");
    }
}
