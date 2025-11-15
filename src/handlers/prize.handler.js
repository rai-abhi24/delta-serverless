/**
 * Prize Breakup Handler
 */

const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const prizeService = require('../services/prize.service');

exports.prizeBreakupHandler = async (request, reply) => {
    const startTime = Date.now();

    try {
        const { match_id, contest_id } = request.body || {};

        if (!match_id) {
            return error(reply, 'match_id is required', 400);
        }

        if (!contest_id) {
            return error(reply, 'contest_id is required', 400);
        }

        const result = await prizeService.getPrizeBreakup(
            match_id,
            contest_id
        );

        return success(reply, result, result.code || 200);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack,
            body: request.body,
            duration: Date.now() - startTime,
        }, 'Error in prizeBreakup handler');

        return error(reply, 'Failed to fetch prize breakup', 500);
    }
};