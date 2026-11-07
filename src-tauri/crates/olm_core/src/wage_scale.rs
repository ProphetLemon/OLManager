//! The wage scale the whole game shares, fitted to the authored LEC wages.
//!
//! Fit: ordinary least squares over the 40 authored non-zero wages of rostered
//! LEC players (market value 70k-240k, wage 60k-356k) gives
//! `wage = 24_922 + 1.193 * market_value` (R^2 0.35; the same data against OVR
//! gives R^2 0.45, but market value tracks OVR at R^2 0.83 and is the input
//! every other economy rule already uses). The intercept is rounded to the
//! 25k minimum wage, the slope to 1.19. A 370k star lands at about 465k, a
//! 1.26x ratio; a 100k player at about 144k, in line with the authored 115k-146k.
//!
//! Non-LEC leagues ship either no wage (1577 of 3235 rostered players) or a
//! machine-derived 7% of market value, so only the LEC rows are authoritative.

/// Minimum yearly wage of the scale (the intercept of the fit).
pub const WAGE_SCALE_BASE: u64 = 25_000;
/// Slope of the fit, in percent of market value.
pub const WAGE_SCALE_MARKET_VALUE_PERCENT: u64 = 119;

/// Yearly wage the LEC scale gives a player of `market_value`, rounded up to 1k.
pub fn scale_wage_for_market_value(market_value: u64) -> u32 {
    let raw = WAGE_SCALE_BASE
        .saturating_add(market_value.saturating_mul(WAGE_SCALE_MARKET_VALUE_PERCENT) / 100);
    let rounded = raw.div_ceil(1_000).saturating_mul(1_000);
    rounded.min(u64::from(u32::MAX)) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_gives_a_star_about_one_and_a_quarter_times_market_value() {
        assert_eq!(scale_wage_for_market_value(370_000), 466_000);
    }

    #[test]
    fn scale_keeps_the_minimum_for_zero_value() {
        assert_eq!(scale_wage_for_market_value(0), 25_000);
    }
}
