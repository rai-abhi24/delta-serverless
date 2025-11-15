/**
 * Redis cache manager with multi-layer caching
 * In-memory cache for Lambda + Redis for distributed cache
 */
const zlib = require('zlib');
const Redis = require('ioredis');
const config = require('../config');
const { promisify } = require('util');
const { logger, logCache, logError } = require('./logger');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

let redisClient = null;
let redisConnectionPromise = null;

const memoryCache = new Map();
const MEMORY_CACHE_MAX_SIZE = 500;
const MEMORY_CACHE_TTL_MS = 300_000;
const COMPRESSION_THRESHOLD = 1024; // Compression threshold - compress data larger than 1KB

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
                // tls: config.redis.tls,
                enableReadyCheck: false,
                enableOfflineQueue: false,
                lazyConnect: false,
                maxRetriesPerRequest: 1,
                enableAutoPipelining: true,
                autoPipeliningIgnoredCommands: ['ping'],
            });

            client.on('error', (error) => {
                logError(error, { context: 'redis_client' });
            });

            // Wait for connection to be ready with timeout
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error(`Redis connection timeout after 3000ms`));
                }, 3000);

                client.once('ready', () => {
                    clearTimeout(timeout);
                    redisClient = client;
                    logger.info('Redis client ready');
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
 * Compress data if it exceeds threshold
 */
const maybeCompress = async (data) => {
    const serialized = JSON.stringify(data);
    const size = Buffer.byteLength(serialized, 'utf8');

    if (size < COMPRESSION_THRESHOLD) {
        return { data: serialized, compressed: false };
    }

    try {
        const compressed = await gzip(serialized);
        return {
            data: compressed.toString('base64'),
            compressed: true
        };
    } catch (error) {
        logError(error, { context: 'compression' });
        return { data: serialized, compressed: false };
    }
};

/**
 * Decompress data if needed
 */
const maybeDecompress = async (data, compressed) => {
    if (!compressed) {
        return JSON.parse(data);
    }

    try {
        const buffer = Buffer.from(data, 'base64');
        const decompressed = await gunzip(buffer);
        return JSON.parse(decompressed.toString('utf8'));
    } catch (error) {
        logError(error, { context: 'decompression' });
        return null;
    }
};

/**
 * Get from memory cache with LRU
 * @param {string} key - Cache key
 * @returns {any|null} Cached value or null
 */
const getFromMemory = (key) => {
    const cached = memoryCache.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expiry) {
        memoryCache.delete(key);
        return null;
    }

    // Move to end (LRU)
    memoryCache.delete(key);
    memoryCache.set(key, cached);

    return cached.value;
};

/**
 * Set value in memory cache with LRU eviction
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 */
const setInMemory = (key, value) => {
    if (memoryCache.size >= MEMORY_CACHE_MAX_SIZE) {
        const firstKey = memoryCache.keys().next().value;
        memoryCache.delete(firstKey);
    }

    memoryCache.set(key, {
        value,
        expiry: Date.now() + MEMORY_CACHE_TTL_MS,
    });
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
        if (!value) {
            logCache('get', key, false, Date.now() - startTime);
            return null;
        }

        let parsed;
        if (value.startsWith('{') || value.startsWith('[')) {
            parsed = JSON.parse(value);
        } else {
            parsed = await maybeDecompress(value, true);
        }

        if (parsed) {
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
 * Set value in cache (both memory and Redis) with optional compression
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

        const { data, compressed } = await maybeCompress(value);

        // Using pipeline for better performance
        const pipeline = redis.pipeline();
        pipeline.setex(key, ttlSeconds, data);

        if (compressed) {
            pipeline.setex(`${key}:meta`, ttlSeconds, 'compressed');
        }

        await pipeline.exec();

        logCache('set', key, true, Date.now() - startTime);
        return true;
    } catch (error) {
        logError(error, { context: 'cache_set', key, ttlSeconds });
        return false;
    }
};

/**
 * Multi-get for batch operations
 */
const mget = async (keys) => {
    const startTime = Date.now();

    try {
        if (!keys || keys.length === 0) return {};

        const redis = await getRedisClient();
        if (!redis) return {};

        const values = await redis.mget(...keys);

        const result = {};
        for (let i = 0; i < keys.length; i++) {
            if (values[i]) {
                try {
                    result[keys[i]] = JSON.parse(values[i]);
                    setInMemory(keys[i], result[keys[i]]);
                } catch (e) {
                    // Skip invalid JSON
                }
            }
        }

        logCache('mget', `${keys.length} keys`, true, Date.now() - startTime);
        return result;
    } catch (error) {
        logError(error, { context: 'cache_mget', keyCount: keys.length });
        return {};
    }
};

/**
 * Multi-set for batch operations
 */
const mset = async (keyValuePairs, ttl = 300) => {
    const startTime = Date.now();

    try {
        if (!keyValuePairs || Object.keys(keyValuePairs).length === 0) {
            return false;
        }

        const redis = await getRedisClient();
        if (!redis) return false;

        const pipeline = redis.pipeline();

        for (const [key, value] of Object.entries(keyValuePairs)) {
            const serialized = JSON.stringify(value);
            pipeline.setex(key, ttl, serialized);
            setInMemory(key, value);
        }

        await pipeline.exec();

        logCache('mset', `${Object.keys(keyValuePairs).length} keys`, true, Date.now() - startTime);
        return true;
    } catch (error) {
        logError(error, { context: 'cache_mset' });
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
 * Delete multiple keys matching pattern
 */
const delPattern = async (pattern) => {
    try {
        const redis = await getRedisClient();
        if (!redis) return false;

        const stream = redis.scanStream({
            match: pattern,
            count: 100
        });

        // CORRECTED: Use pipeline() method instead of Pipeline constructor
        const pipeline = redis.pipeline();
        let count = 0;

        stream.on('data', (keys) => {
            for (const key of keys) {
                pipeline.del(key);
                // Remove prefix for memory cache
                const unprefixedKey = key.replace(config.redis.keyPrefix, '');
                memoryCache.delete(unprefixedKey);
                count++;
            }
        });

        await new Promise((resolve, reject) => {
            stream.on('end', resolve);
            stream.on('error', reject);
        });

        if (count > 0) {
            await pipeline.exec();
        }

        logger.info(`Deleted ${count} keys matching pattern: ${pattern}`);
        return true;
    } catch (error) {
        logError(error, { context: 'delPattern', pattern });
        return false;
    }
};

/**
 * Cache-aside with stale-while-revalidate
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

    const lockKey = `lock:${key}`;
    const redis = await getRedisClient();

    if (redis) {
        const acquired = await redis.set(lockKey, '1', 'EX', 5, 'NX');

        if (!acquired) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const retryCache = await get(key);
            if (retryCache !== null) return retryCache;
        }
    }

    try {
        const result = await fn();

        if (result !== null && result !== undefined) {
            await set(key, result, ttl);
        }

        return result;
    } finally {
        if (redis) {
            await redis.del(lockKey);
        }
    }
};

/**
 * Clear all memory cache
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
 * Close Redis client
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

const flushRedis = async () => {
    const redis = await getRedisClient();
    if (!redis) return false;
    await redis.flushdb();
    return true;
}

const viewKeys = async () => {
    const redis = await getRedisClient();
    if (!redis) return false;
    const keys = await redis.keys('*');
    logger.info(`Keys: ${keys}`);
    return true;
}

module.exports = {
    get,
    set,
    mget,
    mset,
    del,
    delPattern,
    clearMemoryCache,
    getStats,
    cacheAside,
    closeClient,
    flushRedis,
    viewKeys
};