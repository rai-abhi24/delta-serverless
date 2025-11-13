const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const userService = require('../services/user.service');
const basicService = require('../services/basic.service');
const apkUpdateService = require('../services/apkUpdate.service');

/**
 * APK Update Handler
 */
exports.apkUpdateHandler = async (request, reply) => {
    try {
        if (request.user) {
            const user_id = request.user || {};
            if (user_id) {
                setImmediate(() => {
                    userService.updateLastActive(user_id).catch(err => {
                        logger.warn({ userId: user_id, error: err.message });
                    });
                });
            }
        } else {
            const userName = request.body.user_id;
            if (userName) {
                setImmediate(() => {
                    userService.updateLastActiveByUsername(userName).catch(err => {
                        logger.warn({ userName, error: err.message });
                    });
                });
            }
        }

        const { version_code, os_type } = request.body || {};

        const result = await apkUpdateService.checkApkUpdate({
            version_code,
            os_type,
        });

        result.whatsAppLink = result.whatsAppLink || 'https://t.me/delta11admin';

        return success(reply, result, 200);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack,
            body: request.body,
        }, 'Error in apkUpdate handler');

        return error(
            reply,
            'Failed to check for updates',
            500
        );
    }
};

/**
 * Stories Handler
 */
exports.getStoriesHandler = async (_request, reply) => {
    try {
        const stories = await basicService.getStories();

        return success(reply, stories);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack
        }, 'Error in getStories handler');

        return error(reply, 'Failed to fetch stories', 500);
    }
};

/**
 * Recent Winners Handler
 */
exports.getRecentWinnersHandler = async (_request, reply) => {
    try {
        const result = await basicService.getRecentWinners();

        return success(reply, result);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack
        }, 'Error in getRecentWinners handler');

        return error(reply, 'Failed to fetch recent winners', 500);
    }
};