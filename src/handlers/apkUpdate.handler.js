/**
 * APK Update Lambda Handler
 */

const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const userService = require('../services/user.service');
const apkUpdateService = require('../services/apkUpdate.service');

exports.apkUpdateHandler = async (request, reply) => {
    try {
        const { user_id, version_code, os_type } = request.body || {};

        if (user_id) {
            setImmediate(() => {
                userService.updateLastActive(user_id).catch(err => {
                    logger.warn({ userId: user_id, error: err.message });
                });
            });
        }

        const result = await apkUpdateService.checkApkUpdate({
            version_code,
            os_type,
        });

        // Add whatsAppLink to response (always included)
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
