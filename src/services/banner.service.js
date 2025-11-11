/**
 * Banner service for promotions and ads
 */

const { queryAll } = require('../config/database');
const cache = require('../utils/cache');
const { CACHE_KEYS, BANNER_TYPES } = require('../utils/constants');
const config = require('../config');
const { logError, logger } = require('../utils/logger');

/**
 * Get promotion banners with caching
 * @returns {Promise<Array>} Promotion banners
 */
const getPromotionBanners = async () => {
    try {
        const cacheKey = CACHE_KEYS.PROMOTIONS;
        logger.debug(`Caching Promotion Banners with key: ${cacheKey} & TTL: ${config.cache.promotions}`);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const banners = await queryAll(
                    'SELECT * FROM banners WHERE type = ?',
                    [BANNER_TYPES.PROMOTION]
                );
                return banners;
            },
            config.cache.promotions
        );
    } catch (error) {
        logError(error, { context: 'getPromotionBanners' });
        return [];
    }
};

/**
 * Get ads settings with caching
 * @returns {Promise<Array>} Ads settings
 */
const getAdsSettings = async () => {
    try {
        const cacheKey = CACHE_KEYS.ADS_SETTINGS;
        logger.debug(`Caching Ads Settings with key: ${cacheKey} & TTL: ${config.cache.adsSettings}`);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const settings = await queryAll('SELECT * FROM ads_settings');
                return settings;
            },
            config.cache.adsSettings
        );
    } catch (error) {
        logError(error, { context: 'getAdsSettings' });
        return [];
    }
};

/**
 * Clear banner and ads cache (useful for admin updates)
 * @returns {Promise<boolean>} Success status
 */
const clearCache = async () => {
    try {
        await cache.del(CACHE_KEYS.PROMOTIONS);
        await cache.del(CACHE_KEYS.ADS_SETTINGS);
        return true;
    } catch (error) {
        logError(error, { context: 'clearBannerCache' });
        return false;
    }
};

module.exports = {
    getPromotionBanners,
    getAdsSettings,
    clearCache,
};