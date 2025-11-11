/**
 * Centralized configuration management
 * Validates and exports all environment variables
 */

require('dotenv').config();

const config = {
    // Environment
    env: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV === 'development',

    // Database configuration
    database: {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || '3306', 10),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '5', 10),
    },

    // Redis configuration
    redis: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || '0', 10),
        keyPrefix: process.env.REDIS_KEY_PREFIX || 'delta11:',
        connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000', 10),
        commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT || '5000', 10),
        retryStrategy: (times) => {
            if (times > 3) return null;
            return Math.min(times * 200, 2000);
        },
        tls: process.env.REDIS_TLS === 'true' ? {
            checkServerIdentity: () => undefined,
            rejectUnauthorized: true
        } : undefined,
        enableReadyCheck: true,
        enableOfflineQueue: true,
        lazyConnect: false,
        maxRetriesPerRequest: 3,
    },

    // Cache TTL settings (in seconds)
    cache: {
        apkUpdate: parseInt(process.env.CACHE_TTL_APK_UPDATE || 600, 10),
        promotions: parseInt(process.env.CACHE_TTL_PROMOTIONS || 86400, 10),
        adsSettings: parseInt(process.env.CACHE_TTL_ADS_SETTINGS || 86400, 10),
        fantasyKeys: parseInt(process.env.CACHE_TTL_FANTASY_KEYS || 3600, 10),
    },

    // App configuration
    app: {
        splashScreen: process.env.SPLASH_SCREEN || '',
        downloadApkPath: process.env.DOWNLOAD_APK_PATH || '',
        forceUpdate: process.env.FORCE_UPDATE === 'true',
        whatsappLink: process.env.WHATSAPP_LINK || 'https://t.me/delta11admin',
        isPlayStoreBuild: parseInt(process.env.IS_PLAYSTORE_BUILD || '0', 10),
    },

    // Logging configuration
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        pretty: process.env.LOG_PRETTY === 'true',
    },

    // AWS configuration
    aws: {
        region: process.env.AWS_REGION || 'ap-south-1',
    },
};

// Validate required configuration
const validateConfig = () => {
    const required = {
        'DB_HOST': config.database.host,
        'DB_NAME': config.database.database,
        'DB_USER': config.database.user,
        'DB_PASSWORD': config.database.password,
        'REDIS_HOST': config.redis.host,
    };

    const missing = Object.entries(required)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
};

// Validate on load (but not in test environment)
if (process.env.NODE_ENV !== 'test') {
    validateConfig();
}

module.exports = config;