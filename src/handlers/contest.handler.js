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
 * Get contests by type
 */
exports.getContestByTypeHandler = async (request, reply) => {
    const startTime = Date.now();

    try {
        const page = parseInt(request.query.page) || 1;
        const { id: user_id } = request?.user || {};
        const { match_id, contest_type_id } = request.body || {};

        if (!match_id) return error(reply, 'match_id is required', 400);
        if (!contest_type_id) return error(reply, 'contest_type_id is required', 400);
        if (!user_id) return error(reply, 'user_id is required', 400);

        const result = await contestService.getContestsByType(
            match_id,
            contest_type_id,
            user_id,
            page
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
        }, 'Error in getContestByType handler');

        return error(reply, 'Failed to fetch contests', 500);
    }
};

/**
 * Get all contests by match
 */
exports.getAllContestByMatchHandler = async (request, reply) => {
    const startTime = Date.now();

    try {
        const page = request.query.page || 1;
        const { match_id } = request.body || {};
        const { id: user_id } = request?.user || {};

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

        const result = await contestService.getAllContestsByMatch(
            match_id,
            user_id,
            parseInt(page) || 1
        );

        return success(reply, result, result.code || 200);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack,
            body: request.body,
            duration: Date.now() - startTime,
        }, 'Error in getAllContestByMatch handler');

        return error(reply, 'Failed to fetch contests', 500);
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

/**
 * Join Contest
 */
exports.joinContestStatusHandler = async (request, reply) => {
    const startTime = Date.now();

    try {
        const { match_id, contest_id } = request.body || {};
        const { id: user_id } = request.user || {};

        if (!match_id) {
            return error(reply, 'match_id is required', 400);
        }

        if (!contest_id) {
            return error(reply, 'contest_id is required', 400);
        }

        if (!user_id) {
            return error(reply, 'user_id is required', 400);
        }

        const result = await contestService.getJoinContestStatus(
            match_id,
            contest_id,
            user_id
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
            duration: Date.now() - startTime
        }, 'Error in joinContestStatus handler');

        return error(reply, 'Failed to check join status', 500);
    }
};

/**
 * Join contest handler
 */
exports.joinContestHandler = async (request, reply) => {
    const startTime = Date.now();

    try {
        const { match_id, contest_id, created_team_id } = request.body || {};
        const { id: user_id } = request.user;

        if (!match_id) return error(reply, 'match_id is required', 400);
        if (!contest_id) return error(reply, 'contest_id is required', 400);
        if (!created_team_id || !Array.isArray(created_team_id) || created_team_id.length === 0) {
            return error(reply, 'created_team_id array is required', 400);
        }

        const result = await contestService.joinContest(
            user_id,
            match_id,
            contest_id,
            created_team_id
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
            duration: Date.now() - startTime
        }, 'Error in joinContest handler');

        return error(reply, 'Failed to join contest', 500);
    }
};