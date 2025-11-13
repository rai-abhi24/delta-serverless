/**
 * Match service - handles match-related operations
 */

const cache = require('../utils/cache');
const { logError, logger } = require('../utils/logger');
const { queryAll, queryOne } = require('../config/database');
const { TABLES } = require('../utils/tablesNames');
const { getFantasyKey } = require('../utils/helper');
const { CACHE_KEYS, CACHE_EXPIRY, MATCH_STATUS } = require('../utils/constants');

/**
 * Get all matches with all related data in ONE query
 * This eliminates the N+1 query problem
 */
const getMatchesWithPlayers = async (page = 1, limit = 10) => {
    try {
        const offset = (page - 1) * limit;
        const currentTime = Math.floor(Date.now() / 1000);

        // Single optimized query with all JOINs
        const query = `
            SELECT 
                -- Match data
                m.match_id, m.title, m.short_title, m.subtitle,
                m.status, m.status_str, m.timestamp_start, m.timestamp_end,
                m.date_start, m.date_end, m.game_state, m.game_state_str,
                m.status_note, m.is_free, m.competition_id, m.format_str,
                m.format, m.event_name, m.last_match_played,
                
                -- Team A data
                ta.team_id as teama_id, ta.name as teama_name,
                ta.short_name as teama_short_name, ta.logo_url as teama_logo_url,
                
                -- Team B data
                tb.team_id as teamb_id, tb.name as teamb_name,
                tb.short_name as teamb_short_name, tb.logo_url as teamb_logo_url,
                
                -- Competition/League data
                comp.title as league_title,
                
                -- Lineup count (subquery)
                (SELECT COUNT(*) FROM ${TABLES.TEAM_A_SQUADS} tas 
                 WHERE tas.match_id = m.match_id AND tas.playing11 = 'true') as lineup_count,
                
                -- Player count (subquery)
                (SELECT COUNT(*) FROM ${TABLES.MASTER_PLAYER} mp 
                 WHERE mp.match_id = m.match_id) as player_count,
                
                -- Mega contest value (subquery)
                COALESCE(
                    (SELECT SUM(total_winning_prize) 
                     FROM ${TABLES.CREATE_CONTESTS} cc 
                     WHERE cc.match_id = m.match_id 
                     AND cc.contest_type IN ('1','6','14','24','10','18','17','25','21','29')
                     AND cc.is_cancelled = 0
                     AND total_winning_prize > 100
                    ), 0
                ) as mega_contest_value,
                
                -- Free contest prize (subquery)
                (SELECT total_winning_prize 
                 FROM ${TABLES.CREATE_CONTESTS} fc 
                 WHERE fc.match_id = m.match_id 
                 AND fc.entry_fees = 0 
                 AND fc.is_cancelled = 0 
                 AND fc.total_winning_prize > 0 
                 AND fc.is_private = 0 
                 LIMIT 1
                ) as free_contest_prize
                
            FROM ${TABLES.MATCHES} m
            LEFT JOIN ${TABLES.TEAM_A} ta ON m.match_id = ta.match_id
            LEFT JOIN ${TABLES.TEAM_B} tb ON m.match_id = tb.match_id
            LEFT JOIN ${TABLES.COMPETITIONS} comp ON m.competition_id = comp.cid
            
            WHERE m.status IN (1, 3)
            AND m.timestamp_start >= ${currentTime}
            AND m.is_cancelled = 0
            
            GROUP BY m.match_id
            ORDER BY m.is_free DESC, m.timestamp_start ASC
            LIMIT ${limit} OFFSET ${offset}
        `;
        console.log(query);
        const matches = await queryAll(query);

        // Get total count
        const countResult = await queryOne(`
            SELECT COUNT(DISTINCT m.match_id) as total
            FROM ${TABLES.MATCHES} m
            INNER JOIN ${TABLES.MASTER_PLAYER} mp ON m.match_id = mp.match_id
            WHERE m.status IN (1, 3)
            AND m.timestamp_start >= ?
            AND m.is_cancelled = 0
        `, [currentTime]);

        const totalItems = countResult?.total || 0;
        const totalPages = Math.ceil(totalItems / limit);

        return {
            matches,
            pagination: {
                current_page: page,
                total_pages: totalPages,
                total_items: totalItems,
                per_page: limit,
            },
        };
    } catch (error) {
        logError(error, { context: 'getMatchesOptimized' });
        throw error;
    }
};

/**
 * Get guru count separately (batch query for all matches at once)
 * @param {Array<number>} matchIds - Array of match IDs
 * @returns {Promise<Record<number, number>>} Map of match_id to guru_count
 */
const getBatchGuruCounts = async (matchIds) => {
    try {
        if (!matchIds || matchIds.length === 0) return {};

        const promoters = await queryOne(`
            SELECT GROUP_CONCAT(user_id) as ids 
            FROM ${TABLES.PROMOTERS_LIST} 
            WHERE status = 2`
        );

        if (!promoters?.ids) return {};

        // Get guru counts for all matches in ONE query
        const placeholders = matchIds.map(() => '?').join(',');
        const results = await queryAll(`
            SELECT match_id, COUNT(*) as guru_count 
            FROM ${TABLES.CREATE_TEAMS} 
            WHERE match_id IN (${placeholders})
            AND user_id IN (${promoters.ids})
            AND team_count = 'T1'
            GROUP BY match_id
        `, matchIds);

        // Convert to map for O(1) lookup
        return results.reduce((acc, row) => {
            acc[row.match_id] = row.guru_count;
            return acc;
        }, {});
    } catch (error) {
        logError(error, { context: 'getBatchGuruCounts' });
        return {};
    }
};

/**
 * Format match date based on time difference
 * @param {number} timestamp - Unix timestamp
 * @returns {Object} Formatted date and time left
 */
const formatMatchDate = (timestamp) => {
    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = Math.round((timestamp - currentTime) / 60);

    const date = new Date(timestamp * 1000);
    let dateStart;

    if (timeDiff > 1440) {
        dateStart = date.toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true,
            timeZone: 'Asia/Kolkata'
        });
    } else {
        dateStart = date.toLocaleString('en-IN', {
            hour: '2-digit', minute: '2-digit', hour12: true,
            timeZone: 'Asia/Kolkata'
        });
    }

    return {
        date_start: dateStart,
        time_left: timeDiff > 0 ? `${timeDiff}Min` : 'time up',
        time_diff_minutes: timeDiff,
    };
};

/**
 * Transform match data with additional info
 * Optimized with parallel queries for better performance
 * @param {Object} match - Raw match data
 * @returns {Promise<Object>} Transformed match
 */
const transformMatch = (match, guruCount = 0) => {
    const { date_start, time_left, time_diff_minutes } = formatMatchDate(match.timestamp_start);

    // Handle last match played
    let lastMatchPlayed = match.last_match_played;
    try {
        const decoded = lastMatchPlayed ? JSON.parse(lastMatchPlayed) : null;
        if (!decoded || (Array.isArray(decoded) && decoded.length === 0)) {
            lastMatchPlayed = '[{"player_id":null,"title":"Last match played data is not available"}]';
        }
    } catch (e) {
        lastMatchPlayed = '[{"player_id":null,"title":"Last match played data is not available"}]';
    }

    const transformed = {
        match_id: match.match_id,
        title: match.title,
        short_title: match.short_title,
        subtitle: match.subtitle,
        status: time_diff_minutes > 0.5 ? 1 : match.status,
        status_str: time_diff_minutes > 0.5 ? 'Upcoming' : match.status_str,
        timestamp_start: match.timestamp_start,
        timestamp_end: match.timestamp_end,
        date_start,
        date_end: match.date_end,
        game_state: match.game_state,
        game_state_str: match.game_state_str,
        status_note: match.status_note,
        is_free: match.is_free,
        competition_id: match.competition_id,
        format_str: match.format_str,
        format: match.format,
        event_name: match.mega_contest_value > 0 ? match.mega_contest_value : match.event_name,
        league_title: match.league_title,
        time_left,
        joined_single_player: 3,
        is_lineup: match.lineup_count > 1,
        single_player_available: match.player_count,
        isMasterExist: 1,
        isNormalExist: 1,
        total_guru: guruCount,
        last_match_played: lastMatchPlayed,
        has_free_contest: match.free_contest_prize ? true : match.is_free === 1,
        ...(match.free_contest_prize && {
            total_winning_prize: match.free_contest_prize
        }),
        teama: match.teama_id ? {
            team_id: match.teama_id,
            name: match.teama_name,
            short_name: match.teama_short_name,
            logo_url: match.teama_logo_url,
        } : null,
        teamb: match.teamb_id ? {
            team_id: match.teamb_id,
            name: match.teamb_name,
            short_name: match.teamb_short_name,
            logo_url: match.teamb_logo_url,
        } : null,
    };

    return transformed;
};

/**
 * Get paginated matches with all transformations
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Matches response
 */
const getMatches = async (params) => {
    const { page = 1 } = params;
    const pageNum = parseInt(page) || 1;
    const cacheKey = CACHE_KEYS.MATCHES(pageNum);

    try {
        // Use cache-aside pattern
        return await cache.cacheAside(
            cacheKey,
            async () => {
                const { matches, pagination } = await getMatchesWithPlayers(pageNum, 10);

                if (!matches || matches.length === 0) {
                    return {
                        maintainance: false,
                        session_expired: false,
                        total_result: 0,
                        status: true,
                        code: 200,
                        message: 'success',
                        response: {
                            matchdata: [{
                                viewType: 3,
                                upcomingmatches: []
                            }]
                        },
                        pagination: {
                            current_page: pageNum,
                            total_pages: 0,
                            total_items: 0,
                        },
                        information_board: null,
                    };
                }

                // Get guru counts for all matches in ONE batch query
                const matchIds = matches.map(m => m.match_id);
                const guruCounts = await getBatchGuruCounts(matchIds);


                // Transform matches
                const transformedMatches = matches.map(match =>
                    transformMatch(match, guruCounts[match.match_id] || 0)
                );

                // Get maintenance status
                const maintainanceStatus = await getFantasyKey('APP_MAINTAINANCE');

                const result = {
                    maintainance: maintainanceStatus == 1,
                    session_expired: false,
                    total_result: transformedMatches.length,
                    status: true,
                    code: 200,
                    message: 'success',
                    response: {
                        matchdata: [{
                            viewType: 3,
                            upcomingmatches: transformedMatches
                        }]
                    },
                    pagination,
                    information_board: null,
                };

                return result;
            },
            600
        );
    } catch (error) {
        logError(error, { context: 'getMatches', page: pageNum });
        throw error;
    }
};

/* --------------------------------- Match History --------------------------------- */

/**
 * Get user's match IDs for all action types in ONE query
 */
const getUserMatchIds = async (userId) => {
    const cacheKey = CACHE_KEYS.USER_MATCH_IDS(userId);
    logger.info(`getUserMatchIds: cacheKey=${cacheKey}`);

    return await cache.cacheAside(
        cacheKey,
        async () => {
            const query = `
                SELECT DISTINCT match_id, 'normal' as source
                FROM ${TABLES.JOIN_CONTESTS}
                WHERE user_id = ?
                UNION
                SELECT DISTINCT match_id, 'master' as source
                FROM ${TABLES.MASTER_JOIN_CONTESTS}
                WHERE user_id = ?
            `;
            logger.info(`getMatchHistory: query=${query}`);
            const results = await queryAll(query, [userId, userId]);
            return results.map(r => r.match_id);
        },
        CACHE_EXPIRY.FIVE_MINUTES
    );
};

/**
 * Get matches with all related data in ONE optimized query
 */
const getMatchesWithStats = async (userId, matchIds, actionType, page = 1, limit = 10) => {
    try {
        const offset = (page - 1) * limit;
        const currentTime = Math.floor(Date.now() / 1000);

        let whereClause = '';
        if (actionType === 'upcoming') {
            whereClause = `AND m.status = 1 AND m.timestamp_start >= ${currentTime}`;
        } else if (actionType === 'completed') {
            whereClause = `AND m.status IN (2, 4)`;
        } else if (actionType === 'live') {
            whereClause = `AND m.status = 3`;
        }

        const matchIdsStr = matchIds.join(',');

        const query = `
            SELECT 
                m.match_id, m.title, m.short_title, m.status, m.status_str,
                m.timestamp_start, m.timestamp_end, m.date_start, m.date_end,
                m.game_state, m.game_state_str, m.competition_id, m.current_status,
                m.is_free,
                
                -- Team A
                ta.team_id as teama_id, ta.name as teama_name,
                ta.short_name as teama_short_name, ta.logo_url as teama_logo_url,
                
                -- Team B
                tb.team_id as teamb_id, tb.name as teamb_name,
                tb.short_name as teamb_short_name, tb.logo_url as teamb_logo_url,
                
                -- League title
                comp.title as league_title,
                
                -- User stats (all in subqueries to avoid N+1)
                (SELECT COUNT(*) FROM ${TABLES.MASTER_JOIN_CONTESTS} mjc
                 WHERE mjc.match_id = m.match_id AND mjc.user_id = ${userId}) as master_contests,
                
                (SELECT COUNT(*) FROM ${TABLES.JOIN_CONTESTS} jc
                 WHERE jc.match_id = m.match_id AND jc.user_id = ${userId}) as normal_teams,
                
                (SELECT COUNT(DISTINCT contest_id) FROM ${TABLES.JOIN_CONTESTS} jc2
                 WHERE jc2.match_id = m.match_id AND jc2.user_id = ${userId}) as normal_contests,
                
                (SELECT COUNT(*) FROM ${TABLES.CREATE_TEAMS} ct
                 WHERE ct.match_id = m.match_id AND ct.user_id = ${userId}) as created_teams,
                
                (SELECT COUNT(*) FROM ${TABLES.MASTER_PLAYER} mp
                 WHERE mp.match_id = m.match_id) as player_count,
                
                -- Prize amount (only for completed/live)
                ${actionType !== 'upcoming' ? `
                (SELECT COALESCE(SUM(winning_amount), 0)
                 FROM ${TABLES.JOIN_CONTESTS} jc3
                 WHERE jc3.match_id = m.match_id 
                 AND jc3.user_id = ${userId}
                 AND jc3.ranks > 0
                 AND jc3.cancel_contest = 0
                 AND jc3.winning_amount > 0) as prize_amount
                ` : '0 as prize_amount'}
                
            FROM ${TABLES.MATCHES} m
            LEFT JOIN ${TABLES.TEAM_A} ta ON m.match_id = ta.match_id
            LEFT JOIN ${TABLES.TEAM_B} tb ON m.match_id = tb.match_id
            LEFT JOIN ${TABLES.COMPETITIONS} comp ON m.competition_id = comp.cid
            
            WHERE m.match_id IN (${matchIdsStr})
            ${whereClause}
            
            ORDER BY ${actionType === 'upcoming' ? 'm.created_at DESC' : actionType === 'live' ? 'm.updated_at DESC' : 'm.timestamp_start DESC'}
            LIMIT ${limit} OFFSET ${offset}
        `;

        const matches = await queryAll(query);

        const countQuery = `
            SELECT COUNT(*) as total
            FROM ${TABLES.MATCHES} m
            WHERE m.match_id IN (${matchIdsStr})
            ${whereClause}
        `;

        const countResult = await queryOne(countQuery);

        return {
            matches,
            total: countResult?.total || 0
        };
    } catch (error) {
        logError(error, { context: 'getMatchesWithStats', userId, actionType });
        return { matches: [], total: 0 };
    }
};

/**
 * Transform match data with proper status calculation
 */
const transformMatchHistory = (match, actionType) => {
    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = Math.round((match.timestamp_start - currentTime) / 60);

    let statusStr = match.status_str;
    let status = match.status;

    if (actionType === 'upcoming') {
        statusStr = 'Upcoming';
        status = MATCH_STATUS.UPCOMING;
    } else if (actionType === 'live') {
        if (timeDiff > 0.5) {
            statusStr = 'Upcoming Live';
            status = MATCH_STATUS.LIVE;
        } else {
            statusStr = 'Live';
            status = MATCH_STATUS.LIVE;
        }
    } else if (actionType === 'completed') {
        if (match.status === MATCH_STATUS.ABANDONED) {
            statusStr = 'Abandoned';
        } else if (match.status === MATCH_STATUS.COMPLETED) {
            statusStr = match.current_status === MATCH_STATUS.IN_REVIEW ? 'In Review' : 'Completed';
        }
    }

    const dateStart = new Date(match.timestamp_start * 1000)
        .toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Kolkata'
        });

    return {
        match_id: match.match_id,
        title: match.title,
        short_title: match.short_title,
        status,
        status_str: statusStr,
        timestamp_start: match.timestamp_start,
        timestamp_end: match.timestamp_end,
        date_start: dateStart,
        date_end: match.date_end,
        game_state: match.game_state,
        game_state_str: match.game_state_str,
        competition_id: match.competition_id,
        current_status: match.current_status,

        // League
        league_title: match.league_title,

        // Flags
        has_free_contest: match.is_free === 1,
        isMasterExist: parseInt(match.master_contests || 0),
        isNormalExist: parseInt(match.normal_teams || 0),

        // User stats
        single_player_available: parseInt(match.player_count || 0),
        total_joined_team: parseInt(match.normal_teams || 0),
        total_join_contests: parseInt(match.normal_contests || 0),
        total_created_team: parseInt(match.created_teams || 0),

        // Prize (only for completed/live)
        ...(actionType !== 'upcoming' && {
            prize_amount: parseFloat(match.prize_amount || 0).toFixed(2)
        }),

        // Teams
        teama: match.teama_id ? {
            team_id: match.teama_id,
            name: match.teama_name,
            short_name: match.teama_short_name,
            logo_url: match.teama_logo_url
        } : null,

        teamb: match.teamb_id ? {
            team_id: match.teamb_id,
            name: match.teamb_name,
            short_name: match.teamb_short_name,
            logo_url: match.teamb_logo_url
        } : null
    };
};

/**
 * Get match history by action type
 * Main entry point
 */
const getMatchHistory = async (userId, actionType, page = 1) => {
    const startTime = Date.now();
    logger.info(`getMatchHistory: userId=${userId}, actionType=${actionType}, page=${page}`);

    try {
        if (!userId) {
            return {
                system_time: Math.floor(Date.now() / 1000),
                status: false,
                code: 201,
                message: 'User not found'
            };
        }

        if (!['upcoming', 'completed', 'live'].includes(actionType)) {
            return {
                system_time: Math.floor(Date.now() / 1000),
                status: false,
                code: 400,
                message: 'Invalid action type'
            };
        }

        const cacheKey = CACHE_KEYS.MATCH_HISTORY(userId, actionType, page);
        logger.info(`getMatchHistory: cacheKey=${cacheKey}`);
        return await cache.cacheAside(
            cacheKey,
            async () => {
                const matchIds = await getUserMatchIds(userId);

                if (!matchIds || matchIds.length === 0) {
                    return {
                        status: true,
                        code: 200,
                        message: 'success',
                        system_time: Math.floor(Date.now() / 1000),
                        response: {
                            matchdata: [{
                                action_type: actionType,
                                [actionType === 'upcoming' ? 'upcomingMatch' : actionType]: []
                            }]
                        },
                        pagination: {
                            current_page: page,
                            total_pages: 0
                        }
                    };
                }

                const { matches, total } = await getMatchesWithStats(
                    userId,
                    matchIds,
                    actionType,
                    page
                );

                const transformedMatches = matches.map(m => transformMatchHistory(m, actionType));

                const totalPages = Math.ceil(total / 10);
                const typeKey = actionType === 'upcoming' ? 'upcomingMatch' : actionType;

                const result = {
                    status: true,
                    code: 200,
                    message: 'success',
                    system_time: Math.floor(Date.now() / 1000),
                    response: {
                        matchdata: [{
                            action_type: actionType,
                            [typeKey]: transformedMatches
                        }]
                    },
                    pagination: {
                        current_page: page,
                        total_pages: totalPages
                    },
                    _meta: {
                        processing_time_ms: Date.now() - startTime
                    }
                };

                return result;
            },

            // Different cache TTLs based on action type
            actionType === 'upcoming' ? CACHE_EXPIRY.ONE_MINUTE :
                actionType === 'live' ? CACHE_EXPIRY.THIRTY_SECONDS :
                    CACHE_EXPIRY.ONE_DAY
        );

    } catch (error) {
        logError(error, { context: 'getMatchHistory', userId, actionType });

        return {
            system_time: Math.floor(Date.now() / 1000),
            status: false,
            code: 500,
            message: 'Failed to fetch match history',
            _meta: {
                processing_time_ms: Date.now() - startTime,
                error: true
            }
        };
    }
};

module.exports = {
    getMatches,
    getMatchHistory,
};