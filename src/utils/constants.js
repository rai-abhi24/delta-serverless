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
        OK: 200,
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
        ADS_SETTINGS: 'glb:ads:settings',
        PROMOTIONS: 'glb:banner:promotions',
        STORIES: 'glb:stories',
        RECENT_WINNERS: 'glb:winners:recent',

        FANTASY_KEYS: (key) => `fantasyKeys:${key}`,
        APK_UPDATE: (versionCode) => `apkUpdate:${versionCode}`,
        USER_LAST_ACTIVE: (userId) => `user:${userId}:lastActive`,

        BANNER_CATALOG: () => `cat:bnr:glb`,
        USER_BANNER_FEED: (userId) => `feed:banner:usr:${userId}`,
        USER_MATCHES_AGGREGATE: (userId) => `agg:mtch:usr:${userId}`,
        MATCH_METADATA_BATCH: (matchIds) => `meta:mtch:batch:${matchIds.join('-')}`,

        MATCHES: (pageNum) => `mtch:p${pageNum}`,
        USER_MATCH_IDS: (userId) => `usr:match:ids:${userId}`,
        MATCH_HISTORY: (userId, actionType, page) => `hist:mtch:${actionType}:${userId}:p${page}`,

        MATCH_META: (matchId) => `meta:mtch:${matchId}`,
        CONTEST_CATALOG: (matchId) => `cat:cont:mtch:${matchId}`,
        USER_CONTESTS: (matchId, userId) => `usr:cont:${matchId}:${userId}`,
        USER_TEAMS: (matchId, userId) => `usr:team:${matchId}:${userId}`,
        CONTEST_FEED: (matchId, userId, page) => `feed:cont:${matchId}:${userId}:p${page}`,
        CONTEST_TYPES: () => `meta:cont:types`,

        USER_TOKEN: (hashedToken) => `token:${hashedToken}`,
        USER_BY_MOBILE: (mobileNumber) => `user:mobile:${mobileNumber}`,
        USER_BY_ID: (userId) => `user:id:${userId}`,

        WALLET_BALANCES: (userId) => `wlt:bal:${userId}`,
        WALLET_FULL: (userId, platform) => `wlt:full:${userId}:${platform}`,
        DOCUMENT_STATUS: (userId) => `doc:sts:${userId}`,
        BANK_ACCOUNT_STATUS: (userId) => `bnk:sts:${userId}`,
        REFERRAL_COUNT: (userId) => `ref:cnt:${userId}`,
        ACCOUNT_VERIFICATION: (userId) => `acc:ver:${userId}`,
        PAYMENT_GATEWAYS: (platform) => `pay:gtw:${platform}`,
    },

    CACHE_EXPIRY: {
        THIRTY_SECONDS: 30,
        ONE_MINUTE: 60,
        TWO_MINUTES: 120,
        THREE_MINUTES: 180,
        FOUR_MINUTES: 240,
        FIVE_MINUTES: 300,
        TEN_MINUTES: 600,
        ONE_HOUR: 3600,
        HALF_DAY: 43200,
        ONE_DAY: 86400,
        MINUTE: (minutes) => minutes * 60,
        HOUR: (hours) => hours * 3600,
        DAY: (days) => days * 86400,
        WEEK: (weeks) => weeks * 604800,
    },

    MATCH_STATUS: {
        IN_REVIEW: 0,
        UPCOMING: 1,
        COMPLETED: 2,
        LIVE: 3,
        ABANDONED: 4
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
};