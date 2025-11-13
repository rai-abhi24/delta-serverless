
/**
 * Dynamic Cache TTL Calculator
 * Smart caching based on data state and context
 */

const { CACHE_EXPIRY } = require('./constants');

/**
 * Calculate TTL for verification status
 * @param {number} status - Verification status (0=not submitted, 1=pending, 2=verified, 3=rejected)
 * @returns {number} TTL in seconds
 */
const getVerificationTTL = (status) => {
    switch (status) {
        case 2:
            return CACHE_EXPIRY.ONE_DAY;
        case 3:
            return CACHE_EXPIRY.ONE_DAY;
        case 1:
            return CACHE_EXPIRY.ONE_MINUTE;
        default: // Not submitted
            return CACHE_EXPIRY.TWO_MINUTES;
    }
};

/**
 * Calculate TTL based on wallet balance
 * @param {number} balance - Wallet balance
 * @returns {number} TTL in seconds
 */
const getWalletTTL = (balance) => {
    if (balance === 0) {
        return CACHE_EXPIRY.TWO_MINUTES;
    } else if (balance > 10000) {
        return CACHE_EXPIRY.THIRTY_SECONDS;
    } else {
        return CACHE_EXPIRY.ONE_MINUTE;
    }
};

/**
 * Calculate TTL based on time to match start
 * @param {number} timestampStart - Match start timestamp (unix)
 * @returns {number} TTL in seconds
 */
const getMatchTimingTTL = (timestampStart) => {
    const currentTime = Math.floor(Date.now() / 1000);
    const timeToMatch = timestampStart - currentTime;
    const hoursToMatch = timeToMatch / 3600;

    if (timeToMatch < 0) {
        return CACHE_EXPIRY.ONE_MINUTE;
    } else if (hoursToMatch > 48) {
        return CACHE_EXPIRY.ONE_DAY;
    } else if (hoursToMatch > 24) {
        return CACHE_EXPIRY.HALF_DAY;
    } else if (hoursToMatch > 2) {
        return CACHE_EXPIRY.TEN_MINUTES;
    } else if (hoursToMatch > 0.5) {
        return CACHE_EXPIRY.TWO_MINUTES;
    } else {
        return CACHE_EXPIRY.ONE_MINUTE;
    }
};

module.exports = {
    getVerificationTTL,
    getWalletTTL,
    getMatchTimingTTL
};