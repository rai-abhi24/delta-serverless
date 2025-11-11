/**
 * Match service - handles match-related operations
 * Optimized with parallel queries and efficient data fetching
 */

const cache = require('../utils/cache');
const { logError } = require('../utils/logger');
const { queryAll, queryOne } = require('../config/database');
const { TABLES } = require('../utils/constants');

/**
 * Check if mega contest is available for match
 * @param {number} matchId - Match ID
 * @returns {Promise<number>} Mega contest value
 */
const isMegaContestAvailable = async (matchId) => {
    try {
        const result = await queryOne(`
            SELECT event_name FROM create_contest 
            WHERE match_id = ? 
            AND is_mega_contest = 1 
            AND is_cancelled = 0 
            LIMIT 1
        `, [matchId]
        );
        return result ? parseInt(result.event_name || 0) : 0;
    } catch (error) {
        logError(error, { context: 'isMegaContestAvailable', matchId });
        return 0;
    }
};

/**
 * Get matches with players (base query)
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated matches
 */
const getMatchesWithPlayers = async (page = 1, limit = 10) => {
    try {
        const offset = (page - 1) * limit;
        const currentTime = Math.floor(Date.now() / 1000);

        // Get total count for pagination
        const countQuery = `
            SELECT COUNT(DISTINCT m.match_id) as total
            FROM ${TABLES.MATCHES} m
            INNER JOIN ${TABLES.MASTER_PLAYER} mp ON m.match_id = mp.match_id
            WHERE m.status IN (1, 3)
            AND m.timestamp_start >= ?
            AND m.is_cancelled = 0
        `;

        const [countResult] = await queryAll(countQuery, [currentTime]);
        const totalItems = countResult?.total || 0;
        const totalPages = Math.ceil(totalItems / limit);

        // Get matches with teams
        const matchesQuery = `
            SELECT DISTINCT
                m.match_id,
                m.title,
                m.short_title,
                m.subtitle,
                m.status,
                m.status_str,
                m.timestamp_start,
                m.timestamp_end,
                m.date_start,
                m.date_end,
                m.game_state,
                m.game_state_str,
                m.status_note,
                m.is_free,
                m.competition_id,
                m.format_str,
                m.format,
                m.event_name,
                m.last_match_played,
                ta.team_id as teama_id,
                ta.name as teama_name,
                ta.short_name as teama_short_name,
                ta.logo_url as teama_logo_url,
                tb.team_id as teamb_id,
                tb.name as teamb_name,
                tb.short_name as teamb_short_name,
                tb.logo_url as teamb_logo_url
            FROM ${TABLES.MATCHES} m
            INNER JOIN ${TABLES.MASTER_PLAYER} mp ON m.match_id = mp.match_id
            LEFT JOIN ${TABLES.TEAM_A} ta ON m.match_id = ta.match_id
            LEFT JOIN ${TABLES.TEAM_B} tb ON m.match_id = tb.match_id
            WHERE m.status IN (1, 3)
            AND m.timestamp_start >= ?
            AND m.is_cancelled = 0
            ORDER BY m.is_free DESC, m.timestamp_start ASC
            LIMIT ? OFFSET ?
        `;

        const matches = await queryAll(matchesQuery, [currentTime, limit, offset]);

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
        logError(error, { context: 'getMatchesWithPlayers' });
        throw error;
    }
};


/**
 * Get league title for competition
 * @param {number} competitionId - Competition ID
 * @returns {Promise<string|null>} League title
 */
const getLeagueTitle = async (competitionId) => {
    try {
        if (!competitionId) return null;

        const cacheKey = `league:${competitionId}`;
        return await cache.cacheAside(
            cacheKey,
            async () => {
                const result = await queryOne(
                    'SELECT title FROM competitions WHERE cid = ? LIMIT 1',
                    [competitionId]
                );
                return result?.title || null;
            },
            3600 // Cache for 1 hour
        );
    } catch (error) {
        logError(error, { context: 'getLeagueTitle', competitionId });
        return null;
    }
};

/**
 * Get lineup count for match
 * @param {number} matchId - Match ID
 * @returns {Promise<number>} Lineup count
 */
const getLineupCount = async (matchId) => {
    try {
        const result = await queryOne(
            `SELECT COUNT(*) as count FROM team_a_squads 
       WHERE match_id = ? AND playing11 = 'true'`,
            [matchId]
        );
        return result?.count || 0;
    } catch (error) {
        logError(error, { context: 'getLineupCount', matchId });
        return 0;
    }
};

/**
 * Get total guru count for match
 * @param {number} matchId - Match ID
 * @returns {Promise<number>} Guru count
 */
const getTotalGuruCount = async (matchId) => {
    try {
        // First get promoter IDs
        const promoters = await queryAll(
            'SELECT user_id FROM promoters_list WHERE status = 2'
        );

        if (!promoters || promoters.length === 0) {
            return 0;
        }

        const promoterIds = promoters.map(p => p.user_id);

        // Count guru teams
        const placeholders = promoterIds.map(() => '?').join(',');
        const result = await queryOne(
            `SELECT COUNT(*) as count FROM create_team 
       WHERE match_id = ? 
       AND user_id IN (${placeholders}) 
       AND team_count = 'T1'`,
            [matchId, ...promoterIds]
        );

        return result?.count || 0;
    } catch (error) {
        logError(error, { context: 'getTotalGuruCount', matchId });
        return 0;
    }
};

/**
 * Get player count for match
 * @param {number} matchId - Match ID
 * @returns {Promise<number>} Player count
 */
const getPlayerCount = async (matchId) => {
    try {
        const result = await queryOne(
            'SELECT COUNT(*) as count FROM master_player WHERE match_id = ?',
            [matchId]
        );
        return result?.count || 0;
    } catch (error) {
        logError(error, { context: 'getPlayerCount', matchId });
        return 0;
    }
};

/**
 * Check if free contest exists for match
 * @param {number} matchId - Match ID
 * @returns {Promise<Object|null>} Free contest info or null
 */
const getFreeContest = async (matchId) => {
    try {
        const result = await queryOne(
            `SELECT total_winning_prize FROM create_contest 
       WHERE match_id = ? 
       AND entry_fees = 0 
       AND is_cancelled = 0 
       AND total_winning_prize > 0 
       AND is_private = 0 
       LIMIT 1`,
            [matchId]
        );
        return result;
    } catch (error) {
        logError(error, { context: 'getFreeContest', matchId });
        return null;
    }
};

/**
 * Format match date based on time difference
 * @param {number} timestamp - Unix timestamp
 * @returns {Object} Formatted date and time left
 */
const formatMatchDate = (timestamp) => {
    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = Math.round((timestamp - currentTime) / 60); // in minutes

    let dateStart;
    const date = new Date(timestamp * 1000);

    if (timeDiff > 1440) { // More than 24 hours
        // Format: 01 Jan 2024, 03:30 PM
        dateStart = date.toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Kolkata'
        });
    } else {
        // Format: 03:30 PM
        dateStart = date.toLocaleString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
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
const transformMatch = async (match) => {
    try {
        const matchId = match.match_id;

        // Parallel execution of all queries for better performance
        const [
            leagueTitle,
            lineupCount,
            totalGuru,
            playerCount,
            megaContestValue,
            freeContest,
        ] = await Promise.all([
            getLeagueTitle(match.competition_id),
            getLineupCount(matchId),
            getTotalGuruCount(matchId),
            getPlayerCount(matchId),
            isMegaContestAvailable(matchId),
            getFreeContest(matchId),
        ]);

        // Format date and time
        const { date_start, time_left, time_diff_minutes } = formatMatchDate(match.timestamp_start);

        // Build transformed match object
        const transformed = {
            match_id: match.match_id,
            title: match.title,
            short_title: match.short_title,
            subtitle: match.subtitle,
            status: match.status,
            status_str: match.status_str,
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
            event_name: match.event_name,
            league_title: leagueTitle,
            time_left,
            joined_single_player: 3, // Static value as in original
            is_lineup: lineupCount > 1,
            single_player_available: playerCount,
            isMasterExist: 1, // Static as in original
            isNormalExist: 1, // Static as in original
            total_guru: totalGuru,

            // Team data
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

        // Update status based on time difference
        if (time_diff_minutes > 0.5) {
            transformed.status = 1;
            transformed.status_str = 'Upcoming';
        }

        // Handle mega contest
        if (megaContestValue > 0) {
            transformed.event_name = megaContestValue;
        }

        // Handle last match played data
        let lastMatchPlayed = match.last_match_played;
        try {
            const decoded = lastMatchPlayed ? JSON.parse(lastMatchPlayed) : null;
            if (!decoded || (Array.isArray(decoded) && decoded.length === 0)) {
                lastMatchPlayed = '[{"player_id":null,"title":"Last match played data is not available"}]';
            }
        } catch (e) {
            lastMatchPlayed = '[{"player_id":null,"title":"Last match played data is not available"}]';
        }
        transformed.last_match_played = lastMatchPlayed;

        // Handle free contest
        if (freeContest) {
            transformed.has_free_contest = true;
            transformed.total_winning_prize = freeContest.total_winning_prize;
        } else {
            transformed.has_free_contest = match.is_free === 1;
        }

        return transformed;
    } catch (error) {
        logError(error, { context: 'transformMatch', matchId: match.match_id });
        // Return basic match data on error
        return match;
    }
};

/**
 * Get paginated matches with all transformations
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Matches response
 */
const getMatches = async (body, params) => {
    const { page = 1 } = params;
    const pageNum = parseInt(page) || 1;
    const cacheKey = `getMatchCrickets_${pageNum}`;

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

                // Transform all matches in parallel for better performance
                const transformedMatches = await Promise.all(
                    matches.map(match => transformMatch(match))
                );

                // Get maintenance status
                const maintain = await getFantasyKey('APP_MAINTAINANCE');

                const result = {
                    maintainance: maintain == 1,
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
            60
        );
    } catch (error) {
        logError(error, { context: 'getMatches', page: pageNum });
        throw error;
    }
};

module.exports = {
    getMatches,
    isMegaContestAvailable,
    transformMatch,
};