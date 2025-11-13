/**
 * User service for user-related operations
 */

const { queryOne, executeQuery } = require('../config/database');
const cache = require('../utils/cache');
const { CACHE_KEYS, CACHE_EXPIRY } = require('../utils/constants');
const { logError } = require('../utils/logger');
const { TABLES } = require('../utils/tablesNames');

/**
 * Find user by ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} User object or null
 */
const findUserById = async (userId) => {
    const cacheKey = CACHE_KEYS.USER_BY_ID(userId);
    try {
        const cached = await cache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const user = await queryOne(`
            SELECT 
                id,
                name,
                user_name,
                mobile_number,
                email,
                is_account_verified,
                team_name,
                rating,
                current_balance,
                total_balance,
                affiliate_user,
                referal_code,
                current_level,
                profile_image,
                team_name,
                status,
                is_account_deleted
            FROM ${TABLES.USERS}
            WHERE id = ?
            LIMIT 1
        `, [userId]);

        if (!user) {
            return null;
        }

        await cache.set(cacheKey, user, CACHE_EXPIRY.ONE_DAY);
        return user;
    } catch (error) {
        logError(error, { context: 'findUserById', userId });
        throw error;
    }
};


/**
 * Find user by mobile number
 * @param {string} mobileNumber - User's mobile number
 * @returns {Promise<Object|null>} User object or null
 */
const findUserByMobile = async (mobileNumber) => {
    const cacheKey = CACHE_KEYS.USER_BY_MOBILE(mobileNumber);
    try {
        return await cache.cacheAside(
            cacheKey,
            async () => {
                const user = await queryOne(`
                    SELECT 
                        id,
                        name,
                        user_name,
                        mobile_number,
                        email,
                        password,
                        is_account_verified,
                        referal_code,
                        current_level,
                        profile_image,
                        team_name,
                        status,
                        is_account_deleted
                    FROM ${TABLES.USERS}
                    WHERE mobile_number = ?
                    LIMIT 1
                `, [mobileNumber]);

                return user;
            },
            CACHE_EXPIRY.ONE_DAY
        );
    } catch (error) {
        logError(error, { context: 'findUserByMobile', mobileNumber });
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
            `UPDATE ${TABLES.USERS} SET last_active_at = ? WHERE id = ?`,
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
 * Update user's last active timestamp
 * Uses async operation to avoid blocking the response
 * @param {string} userName - User name
 * @returns {Promise<boolean>} Success status
 */
const updateLastActiveByUsername = async (userName) => {
    try {
        if (!userName) {
            return false;
        }

        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

        executeQuery(
            `UPDATE ${TABLES.USERS} SET last_active_at = ? WHERE user_name = ?`,
            [now, userName]
        ).catch(error => {
            logError(error, { context: 'updateLastActiveByUsername', userName });
        });

        return true;
    } catch (error) {
        // Don't throw - this is a non-critical operation
        logError(error, { context: 'updateLastActiveByUsername', userName });
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
            `SELECT last_active_at FROM ${TABLES.USERS} WHERE id = ? LIMIT 1`,
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
    findUserByMobile,
    updateLastActive,
    updateLastActiveByUsername,
    getLastActive,
};