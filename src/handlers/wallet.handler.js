/**
 * Wallet Handler
 */

const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const walletService = require('../services/wallet.service');

/**
 * Get wallet handler
 * @route POST /api/v1/getWallet
 */
exports.getWalletHandler = async (request, reply) => {
    const startTime = Date.now();

    try {
        const { id: user_id } = request.user;
        const platform = request.headers.platform || 'ANDROID';

        if (!user_id) {
            return error(reply, 'user_id is required', 400);
        }

        const result = await walletService.getWallet(user_id, platform);

        if (!result.status) {
            return error(reply, result.message, result.code);
        }

        return success(reply, result);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack,
            body: request.body,
            duration: Date.now() - startTime
        }, 'Error in getWallet handler');

        return error(reply, 'Failed to fetch wallet data', 500);
    }
};