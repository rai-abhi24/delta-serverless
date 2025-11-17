const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const playerService = require('../services/player.service');
const userService = require('../services/user.service');

exports.getPlayerHandler = async (request, reply) => {
    const startTime = Date.now();

    try {
        const { match_id } = request.body || {};
        const { id: user_id } = request?.user || {};

        if (!match_id) {
            return error(reply, 'match_id is required', 400);
        }

        if (user_id) {
            setImmediate(() => {
                userService.updateLastActive(user_id).catch(err => {
                    logger.warn({ userId: user_id, error: err.message }, 'Failed to update last active');
                });
            });
        }

        const result = await playerService.getPlayers(match_id);

        if (result._meta) {
            result._meta.total_request_time_ms = Date.now() - startTime;
        }

        return success(reply, result, result.code || 200);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack,
            body: request.body,
            duration: Date.now() - startTime,
        }, 'Error in getPlayer handler');

        return error(reply, 'Failed to fetch player data', 500);
    }
};