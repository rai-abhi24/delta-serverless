/**
 * User service for user-related operations
 */

const { queryOne, executeQuery } = require('../config/database');
const cache = require('../utils/cache');
const { CACHE_KEYS } = require('../utils/constants');
const { logger, logError } = require('../utils/logger');

/**
 * Find user by ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} User object or null
 */
const findUserById = async (userId) => {
    try {
        if (!userId) {
            return null;
        }

        const user = await queryOne(
            'SELECT * FROM users WHERE id = ? LIMIT 1',
            [userId]
        );

        return user;
    } catch (error) {
        logError(error, { context: 'findUserById', userId });
        throw error;
    }
};

/**
 * Update user's last active timestamp
 * Uses async operation to avoid blocking the response
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
const updateLastActive = async (userId) => {
    try {
        if (!userId) {
            return false;
        }

        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

        executeQuery(
            'UPDATE users SET last_active_at = ? WHERE id = ?',
            [now, userId]
        ).catch(error => {
            logError(error, { context: 'updateLastActive', userId });
        });

        const cacheKey = CACHE_KEYS.USER_LAST_ACTIVE(userId);
        await cache.set(cacheKey, now, 3600);

        return true;
    } catch (error) {
        // Don't throw - this is a non-critical operation
        logError(error, { context: 'updateLastActive', userId });
        return false;
    }
};

/**
 * Get user's last active timestamp
 * @param {number} userId - User ID
 * @returns {Promise<string|null>} Last active timestamp or null
 */
const getLastActive = async (userId) => {
    try {
        if (!userId) {
            return null;
        }

        // Try cache first
        const cacheKey = CACHE_KEYS.USER_LAST_ACTIVE(userId);
        const cached = await cache.get(cacheKey);

        if (cached) {
            return cached;
        }

        // Query database
        const result = await queryOne(
            'SELECT last_active_at FROM users WHERE id = ? LIMIT 1',
            [userId]
        );

        if (result && result.last_active_at) {
            await cache.set(cacheKey, result.last_active_at, 300);
            return result.last_active_at;
        }

        return null;
    } catch (error) {
        logError(error, { context: 'getLastActive', userId });
        return null;
    }
};

module.exports = {
    findUserById,
    updateLastActive,
    getLastActive,
};