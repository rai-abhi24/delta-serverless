/**
 * APK Update service - handles app version checking and configuration
 */

const { queryOne } = require('../config/database');
const cache = require('../utils/cache');
const bannerService = require('./banner.service');
const config = require('../config');
const {
    CACHE_KEYS,
    ACTIVE_SPORTS,
    LUDO_STATUS,
    IOS_CONFIG,
    VERSION_THRESHOLD,
    HTTP_STATUS,
} = require('../utils/constants');
const { logError } = require('../utils/logger');
const { generateRandomString } = require('../utils/helper');

/**
 * Check APK update for iOS devices
 * @param {number} versionCode - Current app version code
 * @returns {Promise<Object>} Update response
 */
const checkIOSUpdate = async (versionCode) => {
    const promotions = await bannerService.getPromotionBanners();

    if (versionCode < IOS_CONFIG.MIN_VERSION_CODE) {
        return {
            status: true,
            code: HTTP_STATUS.OK,
            message: 'success',
            title: 'Minor Bug Fixes',
            url: IOS_CONFIG.APP_STORE_URL,
            splashScreen: '',
            force_update: true,
            release_note: null,
            ...LUDO_STATUS,
            isPlayStoreBuild: config.app.isPlayStoreBuild,
            activeSports: ACTIVE_SPORTS,
            whatsAppLink: config.app.whatsappLink,
        };
    }

    return {
        status: false,
        code: HTTP_STATUS.NO_UPDATE,
        message: 'success',
        title: null,
        url: null,
        splashScreen: '',
        force_update: false,
        promotion: promotions,
        release_note: null,
        ...LUDO_STATUS,
        isPlayStoreBuild: config.app.isPlayStoreBuild,
        activeSports: ACTIVE_SPORTS,
        whatsAppLink: config.app.whatsappLink,
    };
};

/**
 * Check APK update for Android devices
 * @param {number} versionCode - Current app version code
 * @returns {Promise<Object>} Update response
 */
const checkAndroidUpdate = async (versionCode) => {
    const keyvalue = generateRandomString(20);
    const [promotions, adsSettings] = await Promise.all([
        bannerService.getPromotionBanners(),
        bannerService.getAdsSettings(),
    ]);

    if (!versionCode) {
        return buildNoUpdateResponse(keyvalue, promotions, adsSettings);
    }

    // Check if there's a newer version
    const newerVersion = await queryOne(
        'SELECT message, title, release_notes FROM apk_updates WHERE version_code > ? ORDER BY version_code DESC LIMIT 1',
        [versionCode]
    );

    if (newerVersion) {
        return buildUpdateResponse(newerVersion, promotions, adsSettings);
    }

    // Check if version is too old (more than VERSION_THRESHOLD ahead)
    const currentVersion = await queryOne(
        'SELECT message, title, release_notes, version_code FROM apk_updates ORDER BY version_code DESC LIMIT 1'
    );

    if (currentVersion && versionCode > currentVersion.version_code + VERSION_THRESHOLD) {
        return buildUpdateResponse(currentVersion, promotions, adsSettings);
    }

    return buildNoUpdateResponse(keyvalue, promotions, adsSettings);
};

/**
 * Build update available response
 * @param {Object} versionInfo - Version information from database
 * @param {Array} promotions - Promotion banners
 * @param {Array} adsSettings - Ads settings
 * @returns {Object} Update response
 */
const buildUpdateResponse = (versionInfo, promotions, adsSettings) => {
    return {
        splashScreen: config.app.splashScreen,
        status: true,
        code: HTTP_STATUS.OK,
        message: versionInfo.message || 'Update is available',
        url: config.app.downloadApkPath,
        title: versionInfo.title,
        release_note: versionInfo.release_notes || 'new updates',
        promotion: promotions,
        ads_setting: adsSettings,
        ...LUDO_STATUS,
        isPlayStoreBuild: config.app.isPlayStoreBuild,
        activeSports: ACTIVE_SPORTS,
        whatsAppLink: config.app.whatsappLink,
    };
};

/**
 * Build no update response
 * @param {string} keyvalue - Random key value
 * @param {Array} promotions - Promotion banners
 * @param {Array} adsSettings - Ads settings
 * @returns {Object} No update response
 */
const buildNoUpdateResponse = (keyvalue, promotions, adsSettings) => {
    return {
        force_update: config.app.forceUpdate,
        splashScreen: config.app.splashScreen,
        status: false,
        code: HTTP_STATUS.NO_UPDATE,
        message: keyvalue,
        title: null,
        url: null,
        release_note: null,
        promotion: promotions,
        ads_setting: adsSettings,
        ...LUDO_STATUS,
        isPlayStoreBuild: config.app.isPlayStoreBuild,
        activeSports: ACTIVE_SPORTS,
        whatsAppLink: config.app.whatsappLink,
    };
};

/**
 * Main APK update check function
 * @param {Object} params - Request parameters
 * @returns {Promise<Object>} Update response
 */
const checkApkUpdate = async (params) => {
    const { version_code: versionCode, os_type: osType } = params;
    const cacheKey = CACHE_KEYS.APK_UPDATE(versionCode || 0);

    try {
        return await cache.cacheAside(
            cacheKey,
            async () => {
                if (osType === 'ios') {
                    return await checkIOSUpdate(parseInt(versionCode) || 0);
                }

                return await checkAndroidUpdate(parseInt(versionCode) || 0);
            },
            config.cache.apkUpdate
        );
    } catch (error) {
        logError(error, { context: 'checkApkUpdate', versionCode, osType });

        return buildNoUpdateResponse(
            generateRandomString(20),
            [],
            []
        );
    }
};

module.exports = {
    checkApkUpdate,
};