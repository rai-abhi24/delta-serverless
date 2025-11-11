const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const bannerService = require('../services/banner.service');
const userService = require('../services/user.service');

exports.bannerHandler = async (request, reply) => {
    const startTime = Date.now();

    try {
        const { user_id } = request.body || {};

        if (!user_id) {
            return error(reply, 'user_id is required', 400);
        }

        setImmediate(() => {
            userService.updateLastActive(user_id).catch(err => {
                logger.warn({ userId: user_id, error: err.message }, 'Failed to update last active');
            });
        });

        const result = await bannerService.getBanners(user_id);
        if (result._meta) {
            result._meta.total_request_time_ms = Date.now() - startTime;
        }

        return success(reply, result, result.code || 200);
    } catch (error) {
        logger.error({
            error: err.message,
            stack: err.stack,
            body: request.body,
            duration: Date.now() - startTime,
        }, 'Error in getBanners handler');

        return error(
            reply,
            'Failed to fetch banner data',
            500
        );
    }
};