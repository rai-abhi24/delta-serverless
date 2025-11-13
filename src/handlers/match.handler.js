/**
 * Matches Lambda Handler
 * Handles match-related endpoints
 */

const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const matchesService = require('../services/match.service');
const userService = require('../services/user.service');

exports.getMatchHandler = async (request, reply) => {
    try {
        const page = request.query.page || 1;

        const result = await matchesService.getMatches({ page });

        return success(reply, result, result.code || 200);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack,
            query: request.query,
            body: request.body,
        }, 'Error in getMatches handler');

        return error(
            reply,
            'Failed to fetch matches',
            500
        );
    }
};

exports.getMatchHistoryHandler = async (request, reply) => {
    try {
        const page = request.query.page || 1;
        const { user_id, action_type } = request.body;

        setImmediate(() => {
            userService.updateLastActive(user_id).catch(err => {
                logger.warn({ userId: user_id, error: err.message },
                    'Failed to update last active');
            });
        });

        const result = await matchesService.getMatchHistory(user_id, action_type, page);

        return success(reply, result, result.code || 200);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack,
            query: request.query,
            body: request.body,
        }, 'Error in getMatchHistory handler');

        return error(
            reply,
            'Failed to fetch match history',
            500
        );
    }
};