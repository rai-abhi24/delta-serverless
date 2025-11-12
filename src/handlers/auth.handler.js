/**
 * Authentication handlers
 */

const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const authService = require('../services/auth.service');

/**
 * Login handler
 */
exports.loginHandler = async (request, reply) => {
    try {
        const { mobile_number, password, device_token } = request.body || {};

        const result = await authService.loginByMobile({
            mobile_number,
            password,
            device_token,
        });

        if (!result.status) {
            return error(reply, result.message, result.code);
        }

        return success(reply, result, result.code);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack,
            body: request.body,
        }, 'Error in login handler');

        return error(
            reply,
            'Login failed',
            500
        );
    }
};

/**
 * Logout handler
 */
exports.logoutHandler = async (request, reply) => {
    try {
        const token = request.token;

        await authService.logout(token);

        return success(reply, {
            message: 'Logout successful',
        });
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack,
        }, 'Error in logout handler');

        return error(
            reply,
            'Logout failed',
            500
        );
    }
};
