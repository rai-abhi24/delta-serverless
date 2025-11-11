/**
 * Application-wide constants
 */

module.exports = {
    // Active sports configuration
    ACTIVE_SPORTS: {
        cricket: 1,
        football: 1,
        kabaddi: 2,
    },

    // Ludo game status
    LUDO_STATUS: {
        isLudoActive: 0,
        isClassicLudoActive: 0,
        isOnexLudoActive: 0,
        isQuickLudoActive: 0,
    },

    // Response codes
    HTTP_STATUS: {
        SUCCESS: 200,
        NO_UPDATE: 201,
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        INTERNAL_ERROR: 500,
        SERVICE_UNAVAILABLE: 503,
    },

    // Banner types
    BANNER_TYPES: {
        PROMOTION: 'Promotion',
        ADVERTISEMENT: 'Advertisement',
    },

    // Cache keys
    CACHE_KEYS: {
        APK_UPDATE: (versionCode) => `apkUpdate:${versionCode}`,
        PROMOTIONS: 'promotionsBanners',
        ADS_SETTINGS: 'adsSettings',
        FANTASY_KEYS: (key) => `fantasyKeys:${key}`,
        USER_LAST_ACTIVE: (userId) => `user:${userId}:lastActive`,
    },

    // iOS app configuration
    IOS_CONFIG: {
        MIN_VERSION_CODE: 23,
        APP_STORE_URL: 'https://apps.apple.com/in/app/onexgames-cricket/id6737540758',
    },

    // APK version threshold
    VERSION_THRESHOLD: 7,

    // Request timeouts (in milliseconds)
    TIMEOUTS: {
        DATABASE: 10000,
        REDIS: 5000,
        HTTP: 10000,
    },

    // DB Table names
    TABLES: {
        CONTEST_TYPES: 'contest_types',
        FANTASY_KEYS: 'fantasy_keys',
        MASTER_PLAYER: 'master_player',
        MATCHES: 'matches',
        PLAYERS: 'players',
        TEAM_A: 'team_a',
        TEAM_B: 'team_b',
        USERS: 'users',
    },

};