const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const leaderboardService = require('../services/leaderboard.service');

/**
 * Get leaderboard for a contest
 */
exports.getLeaderboardHandler = async (request, reply) => {
    const startTime = Date.now();

    try {
        const { match_id, contest_id, user_id } = request.body || {};
        const page = parseInt(request.query?.page || 1);

        if (!match_id) return error(reply, 'match_id is required', 400);
        if (!contest_id) return error(reply, 'contest_id is required', 400);
        if (!user_id) return error(reply, 'user_id is required', 400);
        if (page >= 51) return error(reply, 'leaderBoard not available', 201);

        const result = await leaderboardService.getLeaderboard(
            match_id,
            contest_id,
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
            duration: Date.now() - startTime
        }, 'Error in leaderboard handler');

        return error(reply, 'Failed to fetch leaderboard', 500);
    }
};