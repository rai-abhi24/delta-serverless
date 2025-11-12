/**
 * Authentication middleware - validates Bearer tokens
 */

const authService = require('../services/auth.service');
const { unauthorized } = require('../utils/response');
const { logger } = require('../utils/logger');

/**
 * Authentication middleware
 * Validates Bearer token and attaches user to request
 */
const authenticate = async (request, reply) => {
    try {
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return unauthorized(reply, 'Missing or invalid authorization header');
        }

        const token = authHeader.substring(7);

        const user = await authService.validateToken(token);

        if (!user) {
            return unauthorized(reply, 'Invalid or expired token');
        }

        if (user.is_account_deleted === 1) {
            return unauthorized(reply, 'Account is deleted');
        }

        if (user.status === 0) {
            return unauthorized(reply, 'Account is disabled');
        }

        request.user = user;
        request.token = token;
    } catch (error) {
        logger.error({
            error: error.message,
            stack: error.stack,
            url: request.url,
        }, 'Authentication error');

        return unauthorized(reply, 'Authentication failed');
    }
};

module.exports = {
    authenticate,
};