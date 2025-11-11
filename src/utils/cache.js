/**
 * Redis cache manager with multi-layer caching
 * In-memory cache for Lambda + Redis for distributed cache
 */
const Redis = require('ioredis');
const config = require('../config');
const { logger, logCache, logError } = require('./logger');

let redisClient = null;
let redisConnectionPromise = null;
const memoryCache = new Map();
const MEMORY_CACHE_MAX_SIZE = 100;
const MEMORY_CACHE_TTL = 60000;

/**
 * Get or create Redis client
 * Reuses client across Lambda invocations
 * @returns {Promise<Redis>} Redis client (ready to use)
 */
const getRedisClient = async () => {
    if (redisClient && redisClient.status === 'ready') {
        return redisClient;
    }

    // If connection is in progress, wait for it
    if (redisConnectionPromise) {
        return redisConnectionPromise;
    }

    // Create new connection
    redisConnectionPromise = (async () => {
        try {
            const client = new Redis({
                host: config.redis.host,
                port: config.redis.port,
                password: config.redis.password,
                db: config.redis.db,
                keyPrefix: config.redis.keyPrefix,
                connectTimeout: config.redis.connectTimeout,
                commandTimeout: config.redis.commandTimeout,
                retryStrategy: config.redis.retryStrategy,
                tls: config.redis.tls,
                enableReadyCheck: config.redis.enableReadyCheck,
                enableOfflineQueue: config.redis.enableOfflineQueue,
                lazyConnect: config.redis.lazyConnect,
                maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
                maxLoadingRetryTime: config.redis.connectTimeout,
                enableAutoPipelining: false,
            });

            client.on('error', (error) => {
                logError(error, { context: 'redis_client' });
            });

            client.on('connect', () => {
                logger.info('Redis client connected');
            });

            client.on('ready', () => {
                logger.info('Redis client ready');
                redisClient = client;
            });

            // Wait for connection to be ready with timeout
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error(`Redis connection timeout after ${config.redis.connectTimeout}ms`));
                }, config.redis.connectTimeout);

                client.once('ready', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                client.once('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });

            return client;

        } catch (error) {
            logError(error, { context: 'redis_client_creation' });
            redisConnectionPromise = null;
            throw error;
        }
    })();

    return redisConnectionPromise;
};

/**
 * Get value from cache (memory first, then Redis)
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} Cached value or null
 */
const get = async (key) => {
    const startTime = Date.now();

    try {
        const memoryResult = getFromMemory(key);
        if (memoryResult !== null) {
            logCache('get', key, true, Date.now() - startTime);
            return memoryResult;
        }

        const redis = await getRedisClient();
        if (!redis) {
            logCache('get', key, false, Date.now() - startTime);
            return null;
        }

        const value = await redis.get(key);

        if (value) {
            const parsed = JSON.parse(value);
            setInMemory(key, parsed);
            logCache('get', key, true, Date.now() - startTime);
            return parsed;
        }

        logCache('get', key, false, Date.now() - startTime);
        return null;
    } catch (error) {
        logError(error, { context: 'cache_get', key });
        return null;
    }
};

/**
 * Set value in cache (both memory and Redis)
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttl - Time to live in seconds
 * @returns {Promise<boolean>} Success status
 */
const set = async (key, value, ttlSeconds = 300) => {
    const startTime = Date.now();

    try {
        setInMemory(key, value);

        const redis = await getRedisClient();
        if (!redis) {
            logCache('set', key, false, Date.now() - startTime);
            return false;
        }

        const serialized = JSON.stringify(value);
        await redis.setex(key, ttlSeconds, serialized);

        logCache('set', key, true, Date.now() - startTime);
        return true;
    } catch (error) {
        logError(error, { context: 'cache_set', key, ttlSeconds });
        return false;
    }
};

/**
 * Delete value from cache
 * @param {string} key - Cache key
 * @returns {Promise<boolean>} Success status
 */
const del = async (key) => {
    const startTime = Date.now();

    try {
        memoryCache.delete(key);

        const redis = await getRedisClient();
        if (!redis) {
            logCache('delete', key, false, Date.now() - startTime);
            return false;
        }

        await redis.del(key);

        logCache('delete', key, true, Date.now() - startTime);
        return true;
    } catch (error) {
        logError(error, { context: 'cache_delete', key });
        return false;
    }
};

/**
 * Get value from memory cache
 * @param {string} key - Cache key
 * @returns {any|null} Cached value or null
 */
const getFromMemory = (key) => {
    const cached = memoryCache.get(key);

    if (!cached) {
        return null;
    }

    if (Date.now() > cached.expiry) {
        memoryCache.delete(key);
        return null;
    }

    return cached.value;
};

/**
 * Set value in memory cache with LRU eviction
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 */
const setInMemory = (key, value) => {
    // Implement simple LRU: remove oldest if cache is full
    if (memoryCache.size >= MEMORY_CACHE_MAX_SIZE) {
        const firstKey = memoryCache.keys().next().value;
        memoryCache.delete(firstKey);
    }

    memoryCache.set(key, {
        value,
        expiry: Date.now() + MEMORY_CACHE_TTL,
    });
};

/**
 * Clear all memory cache (useful for testing)
 */
const clearMemoryCache = () => {
    memoryCache.clear();
    logger.debug('Memory cache cleared');
};

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
const getStats = () => {
    return {
        memoryCacheSize: memoryCache.size,
        memoryCacheMaxSize: MEMORY_CACHE_MAX_SIZE,
        redisConnected: redisClient?.status === 'ready',
    };
};

/**
 * Cache-aside pattern helper
 * Gets from cache or executes function and caches result
 * @param {string} key - Cache key
 * @param {Function} fn - Function to execute if cache miss
 * @param {number} ttl - Time to live in seconds
 * @returns {Promise<any>} Cached or computed value
 */
const cacheAside = async (key, fn, ttl = 300) => {
    const cached = await get(key);
    if (cached !== null) {
        return cached;
    }

    const result = await fn();

    if (result !== null && result !== undefined) {
        await set(key, result, ttl);
    }

    return result;
};

/**
 * Close Redis client (for cleanup)
 */
const closeClient = async () => {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
        redisConnectionPromise = null;
        logger.info('Redis client closed');
    }
    clearMemoryCache();
};

module.exports = {
    get,
    set,
    del,
    clearMemoryCache,
    getStats,
    cacheAside,
    closeClient,
};