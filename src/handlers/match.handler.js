/**
 * Matches Lambda Handler
 * Handles match-related endpoints
 */

const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const matchesService = require('../services/match.service');

exports.getMatchHandler = async (request, reply) => {
    try {
        const page = request.query.page || 1;
        const body = request.body || {};

        const result = await matchesService.getMatches(body, { page });

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