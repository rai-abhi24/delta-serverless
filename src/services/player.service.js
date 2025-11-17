// src/services/player.service.js
const cache = require('../utils/cache');
const { queryAll, queryOne } = require('../config/database');
const { TABLES } = require('../utils/tablesNames');
const { CACHE_KEYS, CACHE_EXPIRY, CRICKET } = require('../utils/constants');
const { logError, logger } = require('../utils/logger');

const { MATCH_STATUS } = CRICKET;

/**
 * Get all player data
 */
const getAllPlayers = async (matchId) => {
    try {
        const query = `
            SELECT 
                -- Player core data
                p.id, p.pid, p.match_id, p.team_id,
                p.title, p.short_name, p.first_name, p.last_name,
                p.playing_role, p.fantasy_player_rating,
                p.birthdate, p.nationality,
                p.batting_style, p.bowling_style,
                
                -- Team names
                CASE 
                    WHEN p.team_id = ta.team_id THEN ta.short_name
                    WHEN p.team_id = tb.team_id THEN tb.short_name
                    ELSE NULL
                END as team_name,
                
                -- Playing11 status (optimized subquery)
                CASE
                    WHEN tas.player_id IS NOT NULL AND tas.playing11 = 'true' THEN true
                    WHEN tbs.player_id IS NOT NULL AND tbs.playing11 = 'true' THEN true
                    ELSE false
                END as playing11,
                
                -- Player image from cricket_players
                COALESCE(cp.player_img, 'https://onex11.com/playerProfile.png') as player_image,
                
                -- Match points
                COALESCE(mp.point, 0) as points,
                
                -- Analytics data (pre-aggregated)
                COALESCE(pa_sel.selection_pct, 0) as selection_pct,
                COALESCE(pa_cap.captain_pct, 0) as captain_pct,
                COALESCE(pa_vc.vice_captain_pct, 0) as vice_captain_pct,
                
                -- Series points (pre-aggregated)
                COALESCE(series_pts.total_points, 0) as series_points
                
            FROM ${TABLES.PLAYERS} p
            
            -- Team data
            LEFT JOIN ${TABLES.TEAM_A} ta ON p.match_id = ta.match_id
            LEFT JOIN ${TABLES.TEAM_B} tb ON p.match_id = tb.match_id
            
            -- Squad data for playing11
            LEFT JOIN ${TABLES.TEAM_A_SQUADS} tas 
                ON p.match_id = tas.match_id AND p.pid = tas.player_id
            LEFT JOIN ${TABLES.TEAM_B_SQUADS} tbs 
                ON p.match_id = tbs.match_id AND p.pid = tbs.player_id
            
            -- Player images
            LEFT JOIN ${TABLES.CRICKET_PLAYERS} cp ON p.pid = cp.pid
            
            -- Match points
            LEFT JOIN ${TABLES.MATCH_PLAYER_POINTS} mp 
                ON p.match_id = mp.match_id AND p.pid = mp.pid
            
            -- Analytics: Selection %
            LEFT JOIN (
                SELECT 
                    match_id,
                    player_id,
                    ROUND((COUNT(*) * 100.0 / (
                        SELECT COUNT(*) 
                        FROM ${TABLES.CREATE_TEAMS} 
                        WHERE match_id = ?
                    )), 2) as selection_pct
                FROM ${TABLES.PLAYER_ANALYTICS}
                WHERE match_id = ? AND created_team_id > 0
                GROUP BY match_id, player_id
            ) pa_sel ON p.match_id = pa_sel.match_id AND p.pid = pa_sel.player_id
            
            -- Analytics: Captain %
            LEFT JOIN (
                SELECT 
                    match_id,
                    captain as player_id,
                    ROUND((COUNT(*) * 100.0 / (
                        SELECT COUNT(*) 
                        FROM ${TABLES.CREATE_TEAMS} 
                        WHERE match_id = ?
                    )), 2) as captain_pct
                FROM ${TABLES.CREATE_TEAMS}
                WHERE match_id = ?
                GROUP BY match_id, captain
            ) pa_cap ON p.match_id = pa_cap.match_id AND p.pid = pa_cap.player_id
            
            -- Analytics: Vice-Captain %
            LEFT JOIN (
                SELECT 
                    match_id,
                    vice_captain as player_id,
                    ROUND((COUNT(*) * 100.0 / (
                        SELECT COUNT(*) 
                        FROM ${TABLES.CREATE_TEAMS} 
                        WHERE match_id = ?
                    )), 2) as vice_captain_pct
                FROM ${TABLES.CREATE_TEAMS}
                WHERE match_id = ?
                GROUP BY match_id, vice_captain
            ) pa_vc ON p.match_id = pa_vc.match_id AND p.pid = pa_vc.player_id
            
            -- Series points (last 5 matches in competition)
            LEFT JOIN (
                SELECT 
                    mp2.pid,
                    SUM(mp2.point) as total_points
                FROM ${TABLES.MATCH_PLAYER_POINTS} mp2
                INNER JOIN ${TABLES.MATCHES} m2 
                    ON mp2.match_id = m2.match_id
                WHERE m2.competition_id = (
                    SELECT competition_id 
                    FROM ${TABLES.MATCHES} 
                    WHERE match_id = ? 
                    LIMIT 1
                )
                AND mp2.pid IN (SELECT pid FROM ${TABLES.PLAYERS} WHERE match_id = ?)
                GROUP BY mp2.pid
            ) series_pts ON p.pid = series_pts.pid
            
            WHERE p.match_id = ?
            
            ORDER BY p.fantasy_player_rating DESC
        `;

        const players = await queryAll(query, [
            matchId, matchId,  // selection %
            matchId, matchId,  // captain %
            matchId, matchId,  // vice-captain %
            matchId, matchId,  // series points
            matchId            // main WHERE
        ]);

        return players;
    } catch (error) {
        logError(error, { context: 'getPlayersOptimized', matchId });
        return [];
    }
};

/**
 * Get match metadata
 */
const getMatchMetadata = async (matchId) => {
    try {
        const cacheKey = CACHE_KEYS.MATCH_META(matchId);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const match = await queryOne(`
                    SELECT match_id, status, status_str, format, timestamp_start 
                    FROM ${TABLES.MATCHES}
                    WHERE match_id = ?
                    LIMIT 1
                `, [matchId]);

                return match;
            },
            CACHE_EXPIRY.ONE_DAY
        );
    } catch (error) {
        logError(error, { context: 'getMatchMetadata', matchId });
        return null;
    }
};

/**
 * Check lineup status
 */
const checkLineupStatus = async (matchId) => {
    try {
        const cacheKey = CACHE_KEYS.LINEUP_STATUS(matchId);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const result = await queryOne(`
                    SELECT COUNT(*) as count
                    FROM ${TABLES.TEAM_A_SQUADS}
                    WHERE match_id = ?
                    AND playing11 = 'true'
                `, [matchId]);

                return (result?.count || 0) > 1;
            },
            CACHE_EXPIRY.TEN_MINUTES
        );
    } catch (error) {
        logError(error, { context: 'checkLineupStatus', matchId });
        return false;
    }
};

/**
 * Format player name (Dream11 style)
 */
const formatPlayerName = (title) => {
    if (!title) return '';

    const parts = title.trim().split(' ');

    if (parts.length > 3) {
        return `${parts[0][0]} ${parts[1][0]} ${parts[2][0]} ${parts[3]}`;
    } else if (parts.length === 3) {
        return `${parts[0][0]} ${parts[1][0]} ${parts[2]}`;
    } else if (parts.length === 2) {
        return `${parts[0][0]} ${parts[1]}`;
    }

    return title;
};

/**
 * Transform player data
 */
const transformPlayer = (player) => {
    return {
        pid: player.pid,
        match_id: player.match_id,
        team_id: player.team_id,
        team_name: player.team_name,
        player_image: player.player_image,
        points: parseFloat(player.points || 0),
        short_name: formatPlayerName(player.title || player.short_name),
        full_name: player.title,
        birth_date: player.birthdate,
        nationality: player.nationality,
        batting_style: player.batting_style,
        bowling_style: player.bowling_style,
        fantasy_player_rating: player.fantasy_player_rating,
        playing11: player.playing11 === 1,
        playerPoints: parseInt(player.series_points || 0),
        analytics: {
            selection: parseFloat(player.selection_pct || 0).toFixed(2),
            captain: parseFloat(player.captain_pct || 0).toFixed(2),
            vice_captain: parseFloat(player.vice_captain_pct || 0).toFixed(2)
        }
    };
};

/**
 * Group players by role
 */
const groupPlayersByRole = (players) => {
    const grouped = {
        wk: [],
        bat: [],
        all: [],
        bowl: []
    };

    const seenPids = new Set();

    players.forEach(player => {
        if (seenPids.has(player.pid)) return;
        seenPids.add(player.pid);

        const transformed = transformPlayer(player);
        const role = player.playing_role;

        if (role === 'cap' || role === 'bat') {
            grouped.bat.push(transformed);
        } else if (role === 'wkcap' || role === 'wkbat' || role === 'wk') {
            grouped.wk.push(transformed);
        } else if (role === 'all') {
            grouped.all.push(transformed);
        } else if (role === 'bowl') {
            grouped.bowl.push(transformed);
        } else {
            grouped.bat.push(transformed);
        }
    });

    return grouped;
};

/**
 * Main: Get Players
 */
const getPlayers = async (matchId) => {
    const startTime = Date.now();

    try {
        const match = await getMatchMetadata(matchId);

        if (!match) {
            return {
                status: false,
                code: 201,
                message: 'Invalid match. Please verify and try again.'
            };
        }

        if (match.status === MATCH_STATUS.LIVE) {
            return {
                status: false,
                code: 201,
                message: 'The match is currently live. Player data is locked during live play.'
            };
        }

        let cacheTTL;
        if (match.status === MATCH_STATUS.COMPLETED || match.status === MATCH_STATUS.ABANDONED) {
            cacheTTL = CACHE_EXPIRY.ONE_DAY;
        } else {
            const currentTime = Math.floor(Date.now() / 1000);
            const timeToMatch = match.timestamp_start - currentTime;

            if (timeToMatch > CACHE_EXPIRY.ONE_DAY) {
                cacheTTL = CACHE_EXPIRY.ONE_HOUR;
            } else if (timeToMatch > CACHE_EXPIRY.ONE_HOUR) {
                cacheTTL = CACHE_EXPIRY.TEN_MINUTES;
            } else {
                cacheTTL = CACHE_EXPIRY.TWO_MINUTES;
            }
        }

        const cacheKey = CACHE_KEYS.PLAYERS(matchId);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const [players, isLineup] = await Promise.all([
                    getAllPlayers(matchId),
                    checkLineupStatus(matchId)
                ]);

                if (!players || players.length === 0) {
                    return {
                        status: false,
                        code: 404,
                        message: 'No players available for this match. Please check back later.',
                        response: {
                            players: null
                        }
                    };
                }

                const groupedPlayers = groupPlayersByRole(players);

                // Player count based on format
                const playerCount = match.format === 21 ? 6 : 11;

                const result = {
                    system_time: Math.floor(Date.now() / 1000),
                    status: true,
                    code: 200,
                    message: 'success',
                    is_linup: isLineup,
                    playerCount,
                    response: {
                        players: groupedPlayers
                    },
                    _meta: {
                        processing_time_ms: Date.now() - startTime,
                    }
                };

                logger.info('Players fetched', {
                    matchId,
                    playerCount: players.length,
                    duration: Date.now() - startTime
                });

                return result;
            },
            cacheTTL
        );

    } catch (error) {
        logError(error, { context: 'getPlayers', matchId });

        return {
            system_time: Math.floor(Date.now() / 1000),
            status: false,
            code: 500,
            message: 'Failed to fetch players',
            _meta: {
                processing_time_ms: Date.now() - startTime,
                error: true
            }
        };
    }
};

module.exports = {
    getPlayers
};