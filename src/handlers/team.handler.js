const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const teamService = require('../services/team.service');
const userService = require('../services/user.service');

exports.getMyTeamHandler = async (request, reply) => {
    const startTime = Date.now();

    try {
        const {
            match_id,
            type,
            close_team_id,
            open_team_id
        } = request.body || {};
        const { id: user_id } = request?.user || {};

        if (!match_id) {
            return error(reply, 'match_id is required', 400);
        }

        if (!user_id) {
            return error(reply, 'user_id is required', 400);
        }

        if (type === 'close' && (!close_team_id || !Array.isArray(close_team_id))) {
            return error(reply, 'close_team_id array is required when type is "close"', 400);
        }

        if (type === 'open' && (!open_team_id || !Array.isArray(open_team_id))) {
            return error(reply, 'open_team_id array is required when type is "open"', 400);
        }

        setImmediate(() => {
            userService.updateLastActive(user_id).catch(err => {
                logger.warn({ userId: user_id, error: err.message }, 'Failed to update last active');
            });
        });

        const result = await teamService.getMyTeams(match_id, user_id, {
            type,
            close_team_id,
            open_team_id
        });

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
        }, 'Error in getMyTeam handler');

        return error(reply, 'Failed to fetch my teams', 500);
    }
};