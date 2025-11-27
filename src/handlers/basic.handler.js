const { logger } = require('../utils/logger');
const { success, error } = require('../utils/response');
const userService = require('../services/user.service');
const basicService = require('../services/basic.service');
const apkUpdateService = require('../services/apkUpdate.service');

/**
 * APK Update Handler
 */
exports.apkUpdateHandler = async (request, reply) => {
    try {
        if (request.user) {
            const user_id = request.user.id || {};
            if (user_id) {
                setImmediate(() => {
                    userService.updateLastActive(user_id).catch(err => {
                        logger.warn({ userId: user_id, error: err.message });
                    });
                });
            }
        } else {
            const userName = request.body.user_id;
            if (userName) {
                setImmediate(() => {
                    userService.updateLastActiveByUsername(userName).catch(err => {
                        logger.warn({ userName, error: err.message });
                    });
                });
            }
        }

        const { version_code, os_type } = request.body || {};

        const result = {
            "force_update": false,
            "splashScreen": "",
            "status": false,
            "code": 201,
            "message": "1ht9QnlHWkS3dJ6PMALD",
            "title": null,
            "url": null,
            "release_note": null,
            "promotion": [
                {
                    "id": 41,
                    "title": "ADD",
                    "url": "https://panel.onex11.com/uploads/banners/2025-10-16/banner_1760605136.jpeg",
                    "actiontype": null,
                    "photo": "uploads/banners/2025-10-16/banner_1760605136.jpeg",
                    "description": "dqwas",
                    "type": "Promotion",
                    "sort_by": 0,
                    "status": 1,
                    "created_at": "2025-09-24 13:39:04",
                    "updated_at": "2025-10-16 14:28:56"
                }
            ],
            "ads_setting": null,
            "isLudoActive": 0,
            "isClassicLudoActive": 0,
            "isOnexLudoActive": 0,
            "isQuickLudoActive": 0,
            "isPlayStoreBuild": 1,
            "activeSports": {
                "cricket": 1,
                "football": 1,
                "kabaddi": 2
            },
        }
        // const result = await apkUpdateService.checkApkUpdate({
        //     version_code,
        //     os_type,
        // });

        result.whatsAppLink = result.whatsAppLink || 'https://t.me/delta11admin';

        return success(reply, result, 200);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack,
            body: request.body,
        }, 'Error in apkUpdate handler');

        return error(
            reply,
            'Failed to check for updates',
            500
        );
    }
};

/**
 * Stories Handler
 */
exports.getStoriesHandler = async (_request, reply) => {
    try {
        const stories = await basicService.getStories();

        return reply.code(200).send(stories);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack
        }, 'Error in getStories handler');

        return error(reply, 'Failed to fetch stories', 500);
    }
};

/**
 * Recent Winners Handler
 */
exports.getRecentWinnersHandler = async (_request, reply) => {
    try {
        const result = await basicService.getRecentWinners();

        return reply.code(200).send(result);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack
        }, 'Error in getRecentWinners handler');

        return error(reply, 'Failed to fetch recent winners', 500);
    }
};

/**
 * Device Notification Handler
 */
exports.deviceNotificationHandler = async (request, reply) => {
    try {
        const user_id = request.user.id || {};
        const { device_id } = request.body || {};

        if (!user_id || !device_id) {
            return error(reply, !user_id ? 'user_id is required' : 'device_id is required', 400);
        }

        const result = await basicService.updateDeviceToken(user_id, device_id);

        if (!result.status) {
            return error(reply, result.message, result.code);
        }

        return success(reply, result, result.code);
    } catch (err) {
        logger.error({
            error: err.message,
            stack: err.stack,
            body: request.body,
        }, 'Error in deviceNotification handler');

        return error(reply, 'Failed to update notification settings', 500);
    }
};