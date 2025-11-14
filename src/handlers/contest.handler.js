const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const contestService = require('../services/contest.service');
const userService = require('../services/user.service');

/**
 * Get contests by match
 */
exports.getContestByMatchHandler = async (request, reply) => {
    const startTime = Date.now();

    try {
        const page = request.query.page || 1;
        const { id: user_id } = request?.user || {};
        const { match_id } = request.body || {};

        if (!match_id) {
            return error(reply, 'match_id is required', 400);
        }

        if (!user_id) {
            return error(reply, 'user_id is required', 400);
        }

        setImmediate(() => {
            userService.updateLastActive(user_id).catch(err => {
                logger.warn({ userId: user_id, error: err.message },
                    'Failed to update last active');
            });
        });

        const result = await contestService.getContestsByMatch(
            match_id,
            user_id,
            parseInt(page) || 1
        );

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
        }, 'Error in getContestByMatch handler');

        return error(
            reply,
            'Failed to fetch contest data',
            500
        );
    }
};

/**
 * Get my contests
 */
exports.getMyContestHandler = async (request, reply) => {
    const startTime = Date.now();

    try {
        const { match_id, deviceDetails } = request.body || {};
        const { id: userId } = request?.user || {};

        if (!match_id) {
            return error(reply, 'match_id is required', 400);
        }

        if (!userId) {
            return error(reply, 'user_id is required', 400);
        }

        setImmediate(() => {
            userService.updateLastActive(userId).catch(err => {
                logger.warn({ userId: userId, error: err.message }, 'Failed to update last active');
            });
        });

        const versionCode = deviceDetails?.versionCode || null;

        const result = await contestService.getMyContests(match_id, userId, versionCode);

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
        }, 'Error in getMyContest handler');

        return error(reply, 'Failed to fetch my contests', 500);
    }
};