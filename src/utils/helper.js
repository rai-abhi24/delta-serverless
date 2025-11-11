const config = require('../config');
const cache = require('../utils/cache');
const { CACHE_KEYS } = require("./constants");
const { queryOne } = require('../config/database');

/**
 * Get fantasy keys from database with caching
 * @param {string} key - Key name
 * @returns {Promise<any>} Key value
 */
const getFantasyKey = async (key) => {
    try {
        if (!key) {
            return null;
        }

        const cacheKey = CACHE_KEYS.FANTASY_KEYS(key);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const result = await queryOne(
                    'SELECT value FROM fantasy_keys WHERE `key` = ? LIMIT 1',
                    [key]
                );
                return result ? result.value : null;
            },
            config.cache.fantasyKeys
        );
    } catch (error) {
        logError(error, { context: 'getFantasyKey', key });
        return null;
    }
};


/**
 * Generate random string
 * @param {number} length - String length
 * @returns {string} Random string
 */
const generateRandomString = (length) => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

module.exports = {
    getFantasyKey,
    generateRandomString,
}