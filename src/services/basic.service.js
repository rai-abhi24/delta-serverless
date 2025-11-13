const cache = require("../utils/cache");
const { TABLES } = require("../utils/tablesNames");
const { logError } = require("../utils/logger");
const { queryAll } = require("../config/database");
const { CACHE_KEYS, CACHE_EXPIRY } = require("../utils/constants");
const config = require("../config");

/**
 * Get stories
 */
const getStories = async () => {
    try {
        const cacheKey = CACHE_KEYS.STORIES;

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const stories = await queryAll(`
                    SELECT id, username, photo, video, sort_by
                    FROM ${TABLES.STORIES}
                    ORDER BY sort_by ASC
                `);

                return stories;
            },
            CACHE_EXPIRY.ONE_DAY
        );
    } catch (error) {
        logError(error, { context: 'getStories' });
        return [];
    }
};

/* ----------------------------- RECENT WINNERS ----------------------------- */
const getCompletedMatchesWithWinners = async () => {
    try {
        const cacheKey = CACHE_KEYS.RECENT_WINNERS;

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const matches = await queryAll(`
                    SELECT 
                        m.match_id, m.title, m.timestamp_start, m.competition_id,
                        
                        -- Team A
                        ta.name as teama_name,
                        ta.short_name as teama_short_name,
                        ta.logo_url as teama_logo_url,
                        
                        -- Team B
                        tb.name as teamb_name,
                        tb.short_name as teamb_short_name,
                        tb.logo_url as teamb_logo_url,
                        
                        -- Competition
                        comp.title as competition_title
                        
                    FROM ${TABLES.MATCHES} m
                    LEFT JOIN ${TABLES.TEAM_A} ta ON m.match_id = ta.match_id
                    LEFT JOIN ${TABLES.TEAM_B} tb ON m.match_id = tb.match_id
                    LEFT JOIN ${TABLES.COMPETITIONS} comp ON m.competition_id = comp.cid
                    
                    WHERE m.status = 2
                    AND m.current_status = 1
                    
                    ORDER BY m.timestamp_start DESC
                    LIMIT 10
                `);

                if (!matches || matches.length === 0) {
                    return {
                        'Mega Contest': {
                            matches: []
                        }
                    };
                }

                const matchIds = matches.map(m => m.match_id);

                const winners = await queryAll(`
                    SELECT 
                        rw.match_id,
                        rw.contest_id,
                        rw.rank,
                        rw.won_amount,
                        u.name as winner_name,
                        u.profile_image as winner_profile_image,
                        cc.total_winning_prize
                    FROM ${TABLES.RECENT_WINNERS} rw
                    INNER JOIN ${TABLES.USERS} u ON rw.user_id = u.id
                    INNER JOIN ${TABLES.CREATE_CONTESTS} cc ON rw.contest_id = cc.id
                    WHERE rw.match_id IN (${matchIds.join(',')})
                    ORDER BY rw.match_id, rw.contest_id, rw.rank ASC
                `);

                const winnersByMatch = {};
                winners.forEach(winner => {
                    const key = `${winner.match_id}_${winner.contest_id}`;
                    if (!winnersByMatch[key]) {
                        winnersByMatch[key] = {
                            contest_id: winner.contest_id,
                            total_winning_prize: winner.total_winning_prize,
                            winners: []
                        };
                    }
                    winnersByMatch[key].winners.push({
                        name: winner.winner_name || 'NA',
                        image: winner.winner_profile_image
                            ? (winner.winner_profile_image.startsWith('http')
                                ? winner.winner_profile_image
                                : `${config.app.baseUrl || 'https://1x11.in'}/${winner.winner_profile_image}`)
                            : 'https://1x11.in/playerImage.png',
                        rank: String(winner.rank),
                        won_amount: String(winner.won_amount)
                    });
                });

                const matchData = [];

                matches.forEach(match => {
                    const matchContests = Object.entries(winnersByMatch)
                        .filter(([key]) => key.startsWith(`${match.match_id}_`))
                        .map(([_, data]) => data);

                    matchContests.forEach(contest => {
                        const matchDate = new Date(match.timestamp_start * 1000)
                            .toLocaleDateString('en-GB', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric'
                            });

                        matchData.push({
                            competition_name: match.competition_title || 'NA',
                            team_a: {
                                short_name: match.teama_short_name || 'NA',
                                name: match.teama_name || 'NA',
                                logo: match.teama_logo_url || ''
                            },
                            team_b: {
                                short_name: match.teamb_short_name || 'NA',
                                name: match.teamb_name || 'NA',
                                logo: match.teamb_logo_url || ''
                            },
                            match_name: match.title || 'NA',
                            winning_prize: String(contest.total_winning_prize || 0),
                            match_time: matchDate,
                            winners: contest.winners
                        });
                    });
                });

                return {
                    'Mega Contest': {
                        matches: matchData
                    }
                };
            },
            CACHE_EXPIRY.ONE_DAY
        );
    } catch (error) {
        logError(error, { context: 'getCompletedMatchesWithWinners' });
        return {
            'Mega Contest': {
                matches: []
            }
        };
    }
};

/**
 * Get recent winners (main entry point)
 */
const getRecentWinners = async () => {
    try {
        return await getCompletedMatchesWithWinners();
    } catch (error) {
        logError(error, { context: 'getRecentWinners' });
        return {
            'Mega Contest': {
                matches: []
            }
        };
    }
};

/**
 * Update user's device token for notifications
 * @param {string|number} userId - User ID
 * @param {string} deviceId - Device token
 * @returns {Promise<Object>} Update result
 */
const updateDeviceToken = async (userId, deviceId) => {
    try {
        const user = await queryOne(
            `SELECT id, status, is_account_deleted FROM ${TABLES.USERS} WHERE id = ? LIMIT 1`,
            [userId]
        );

        if (!user) {
            return {
                status: false,
                code: 201,
                message: 'User not found'
            };
        }

        if (user.is_account_deleted === 1) {
            return {
                status: false,
                code: 201,
                message: 'Account is deleted'
            };
        }

        if (user.status === 0) {
            return {
                status: false,
                code: 201,
                message: 'Account is disabled'
            };
        }

        await executeQuery(
            `UPDATE ${TABLES.USERS} SET device_id = ? WHERE id = ?`,
            [deviceId, userId]
        );

        const cacheKey = CACHE_KEYS.USER_BY_ID(userId);
        await cache.del(cacheKey);

        logger.info('Device token updated', { userId, deviceId: deviceId.substring(0, 10) + '...' });

        return {
            status: true,
            code: 200,
            message: 'notification updated'
        };
    } catch (error) {
        logError(error, { context: 'updateDeviceToken', userId });

        return {
            status: false,
            code: 500,
            message: 'something went wrong'
        };
    }
};

module.exports = {
    getStories,
    getRecentWinners,
    updateDeviceToken,
};