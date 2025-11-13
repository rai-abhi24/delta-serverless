/**
 * Authentication service - handles user login and token management
 */

const https = require('https');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cache = require('../utils/cache');
const { TABLES } = require('../utils/tablesNames');
const { logError, logger } = require('../utils/logger');
const { queryOne, executeQuery } = require('../config/database');
const { CACHE_KEYS } = require('../utils/constants');
const userService = require('./user.service');

/**
 * Generate a secure token string
 * Format: {tokenId}|{plainTextToken}
 * @returns {Object} { plainTextToken, hashedToken }
 */
const generateToken = () => {
    const entropy = crypto.randomBytes(32).toString('hex');
    const crc32 = crypto.createHash('md5').update(entropy).digest('hex').substring(0, 8);
    const plainTextToken = `${entropy}${crc32}`;
    const hashedToken = crypto.createHash('sha256').update(plainTextToken).digest('hex');

    return {
        plainTextToken,
        hashedToken,
    };
};

/**
 * Hash password using SHA256
 * @param {string} password - Plain password
 * @param {string} hash - Hashed password from DB
 * @returns {boolean} Password match status
 */
const verifyPassword = (password, hash) => {
    return bcrypt.compareSync(password, hash);
};

/**
 * Create access token for user
 * @param {number} userId - User ID
 * @returns {Promise<string>} Token string in format {id}|{plainTextToken}
 */
const createAccessToken = async (userId, name) => {
    try {
        const { plainTextToken, hashedToken } = generateToken();
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

        await executeQuery(
            `DELETE FROM ${TABLES.PERSONAL_ACCESS_TOKENS} WHERE tokenable_id = ?`,
            [userId]
        );

        const result = await executeQuery(`
            INSERT INTO ${TABLES.PERSONAL_ACCESS_TOKENS}
            (tokenable_type, tokenable_id, name, token, abilities, last_used_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            'App\\User',
            userId,
            name,
            hashedToken,
            JSON.stringify(['*']),
            now,
            now,
            now
        ]);

        const tokenId = result.insertId;
        const fullToken = `${tokenId}|${plainTextToken}`;

        const cacheKey = CACHE_KEYS.USER_TOKEN(hashedToken);
        await cache.set(cacheKey, { userId, tokenId }, 2592000);

        return fullToken;
    } catch (error) {
        logError(error, { context: 'createAccessToken', userId });
        throw error;
    }
};

/**
 * Send OTP via SMS to user
 * @param {string} mobile - Mobile number
 * @param {string} otp - OTP code
 */
const sendOTP = async (mobile, otp) => {
    if (!mobile || !otp) {
        console.error("Invalid arguments: mobile number and otp are required");
        return false;
    }

    const apiKey = process.env.SMS_API_KEY || "";
    const message = encodeURIComponent(
        `Your OTP for ONEX GAMES Account Registration is ${otp} ONEXGM`
    );

    const url = `https://136.243.171.112/api/sendhttp.php?authkey=${apiKey}&mobiles=${mobile}&message=${message}&sender=ONEXGM&route=2&country=91`;

    const fetchWithRetry = (url, retries = 2, timeoutMs = 4000) => {
        return new Promise((resolve, reject) => {
            const attempt = (n) => {
                const req = https.get(url, { timeout: timeoutMs }, (res) => {
                    let data = "";
                    res.on("data", (chunk) => (data += chunk));
                    res.on("end", () => {
                        if (res.statusCode === 200) {
                            resolve(true);
                        } else {
                            if (n > 0) {
                                console.warn(`Retrying... [${2 - n + 1}]`);
                                setTimeout(() => attempt(n - 1), 300);
                            } else {
                                reject(new Error(`HTTP ERROR: ${res.statusCode}`));
                            }
                        }
                    });
                });

                req.on("timeout", () => {
                    req.destroy();
                    if (n > 0) {
                        console.warn(`Timeout, retrying... [${2 - n + 1}]`);
                        setTimeout(() => attempt(n - 1), 300);
                    } else {
                        reject(new Error("Request timeout"));
                    }
                });

                req.on("error", (err) => {
                    if (n > 0) {
                        console.warn(`Network error, retrying... [${2 - n + 1}]`);
                        setTimeout(() => attempt(n - 1), 300);
                    } else {
                        reject(err);
                    }
                });
            };

            attempt(retries);
        });
    };

    try {
        await fetchWithRetry(url);
        console.info(`✅ OTP sent successfully to ${mobileNumber}`);
        return true;
    } catch (err) {
        console.error(`❌ Failed to send OTP: ${err.message}`);
        return false;
    }
};

/**
 * Handle OTP generation for unverified accounts
 * @param {Object} user - User object
 * @returns {Promise<boolean>} Success status
 */
const handleOTPGeneration = async (user) => {
    try {
        const today = new Date().toISOString().slice(0, 10);

        const otpCount = await queryOne(`
            SELECT COUNT(*) as count
            FROM ${TABLES.MOBILE_OTP}
            WHERE mobile = ?
            AND DATE(created_at) = ?
        `, [user.email, today]);

        if (otpCount?.count >= 3) {
            throw new Error('OTP_LIMIT_EXHAUSTED');
        }

        await executeQuery(
            `UPDATE ${TABLES.MOBILE_OTP} SET is_verified = 1 WHERE mobile = ?`,
            [user.email]
        );

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

        await executeQuery(`
            INSERT INTO ${TABLES.MOBILE_OTP}
            (mobile, otp, user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        `, [user.email, otp, user.id, now, now]);


        await sendOTP(user.mobile_number, otp);

        return true;
    } catch (error) {
        logError(error, { context: 'handleOTPGeneration', userId: user.id });
        throw error;
    }
};

/**
 * Login user by mobile number and password
 * @param {Object} credentials - Login credentials
 * @returns {Promise<Object>} Login response
 */
const loginByMobile = async (credentials) => {
    const { mobile_number, password } = credentials;

    try {
        const user = await userService.findUserByMobile(mobile_number);

        if (!user) {
            return {
                status: false,
                code: 201,
                message: 'Account is not registered',
            };
        }

        // Check account status
        if (user.is_account_deleted === 1) {
            return {
                status: false,
                code: 200,
                message: 'Account is deleted, Please contact admin',
            };
        }

        if (user.status === 0) {
            return {
                status: false,
                code: 420,
                message: 'Your Account is disabled. To activate write an email at onex11fantasy@gmail.com',
            };
        }

        const isValidPassword = verifyPassword(password, user.password);
        if (!isValidPassword) {
            return {
                status: false,
                code: 420,
                message: 'Invalid Password',
            };
        }

        const isAdmin = mobile_number === '8962004471';

        if (!isAdmin && user.is_account_verified === 0) {
            try {
                await handleOTPGeneration(user);
            } catch (error) {
                if (error.message === 'OTP_LIMIT_EXHAUSTED') {
                    return {
                        status: false,
                        code: 201,
                        message: 'OTP limit exhausted, please try again tomorrow',
                    };
                }
                throw error;
            }
        }

        const token = await createAccessToken(user.id, user.name);

        const userData = {
            id: user.id,
            name: user.name,
            user_id: user.user_name,
            mobile_number: user.mobile_number,
            email: user.email,
            is_account_verified: isAdmin ? 1 : user.is_account_verified,
            referal_code: user.referal_code,
            current_level: user.current_level,
            profile_image: user.profile_image,
            team_name: user.team_name,
        };

        return {
            status: true,
            code: 200,
            message: 'Login Successfully',
            token,
            user_data: userData,
        };
    } catch (error) {
        logError(error, { context: 'loginByMobile', mobile_number });
        throw error;
    }
};

/**
 * Validate access token and return user
 * @param {string} token - Bearer token in format {id}|{plainTextToken}
 * @returns {Promise<Object|null>} User object or null
 */
const validateToken = async (token) => {
    try {
        if (!token || !token.includes('|')) {
            return null;
        }

        const [tokenId, plainTextToken] = token.split('|');
        if (!tokenId || !plainTextToken) {
            return null;
        }

        // Hash the plain token to match DB
        const hashedToken = crypto.createHash('sha256').update(plainTextToken).digest('hex');

        // Check cache first
        const cacheKey = CACHE_KEYS.USER_TOKEN(hashedToken);
        const cached = await cache.get(cacheKey);

        if (cached) {
            executeQuery(
                `UPDATE ${TABLES.PERSONAL_ACCESS_TOKENS} 
                 SET last_used_at = ? 
                 WHERE id = ?`,
                [new Date().toISOString().slice(0, 19).replace('T', ' '), cached.tokenId]
            ).catch(err => logger.warn({ error: err.message }, 'Failed to update token last_used_at'));

            // Return user from cache
            return await userService.findUserById(cached.userId);
        }

        // Query from DB if not in cache
        const accessToken = await queryOne(`
            SELECT 
                id,
                tokenable_id,
                token,
                created_at,
                expires_at,
                last_used_at
            FROM ${TABLES.PERSONAL_ACCESS_TOKENS}
            WHERE token = ?
            LIMIT 1
        `, [hashedToken]);

        if (!accessToken) {
            return null;
        }

        // Check token expiration (if expires_at is set)
        if (accessToken.expires_at) {
            const expiresAt = new Date(accessToken.expires_at);
            if (expiresAt < new Date()) {
                return null;
            }
        }

        // Update last_used_at
        executeQuery(
            `UPDATE ${TABLES.PERSONAL_ACCESS_TOKENS} 
             SET last_used_at = ? 
             WHERE id = ?`,
            [new Date().toISOString().slice(0, 19).replace('T', ' '), accessToken.id]
        ).catch(err => logger.warn({ error: err.message }, 'Failed to update token last_used_at'));

        // Cache token for future requests
        await cache.set(cacheKey, {
            userId: accessToken.tokenable_id,
            tokenId: accessToken.id
        }, 2592000);

        // Get and return user
        return await userService.findUserById(accessToken.tokenable_id);
    } catch (error) {
        logError(error, { context: 'validateToken' });
        return null;
    }
};

/**
 * Logout user (delete token)
 * @param {string} token - Bearer token
 * @returns {Promise<boolean>} Success status
 */
const logout = async (token) => {
    try {
        if (!token || !token.includes('|')) {
            return false;
        }

        const [, plainTextToken] = token.split('|');
        const hashedToken = crypto.createHash('sha256').update(plainTextToken).digest('hex');

        await executeQuery(
            `DELETE FROM ${TABLES.PERSONAL_ACCESS_TOKENS} WHERE token = ?`,
            [hashedToken]
        );

        const cacheKey = CACHE_KEYS.USER_TOKEN(hashedToken);
        await cache.del(cacheKey);

        return true;
    } catch (error) {
        logError(error, { context: 'logout' });
        return false;
    }
};

module.exports = {
    loginByMobile,
    validateToken,
    logout,
};