const cache = require('../utils/cache');
const { queryAll, queryOne } = require('../config/database');
const { TABLES } = require('../utils/tablesNames');
const { CACHE_KEYS, CACHE_EXPIRY, MATCH_STATUS } = require('../utils/constants');
const { logError, logger } = require('../utils/logger');

/**
 * Get playing11 squad data with caching
 */
const getPlaying11Squad = async (matchId) => {
    try {
        const cacheKey = CACHE_KEYS.MATCH_SQUAD(matchId);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const [teamA, teamB] = await Promise.all([
                    queryAll(
                        `SELECT player_id, role FROM ${TABLES.TEAM_A_SQUADS} 
                         WHERE match_id = ? AND playing11 = 'true'`,
                        [matchId]
                    ),
                    queryAll(
                        `SELECT player_id, role FROM ${TABLES.TEAM_B_SQUADS} 
                         WHERE match_id = ? AND playing11 = 'true'`,
                        [matchId]
                    )
                ]);

                const playing11Map = {};
                [...teamA, ...teamB].forEach(p => {
                    playing11Map[p.player_id] = p.role;
                });

                return playing11Map;
            },
            CACHE_EXPIRY.ONE_DAY
        );
    } catch (error) {
        logError(error, { context: 'getPlaying11Squad', matchId });
        return null;
    }
};

/**
 * Get batch player images (optimized for multiple players)
 */
const getBatchPlayerImages = async (playerIds) => {
    try {
        if (!playerIds || playerIds.length === 0) return {};

        const cacheKeys = playerIds.map(pid => CACHE_KEYS.PLAYER_IMAGE(pid));
        const cached = await cache.mget(cacheKeys);

        const result = {};
        const missingIds = [];

        playerIds.forEach((pid, idx) => {
            if (cached[cacheKeys[idx]]) {
                result[pid] = cached[cacheKeys[idx]];
            } else {
                missingIds.push(pid);
            }
        });

        // Fetch missing from DB in one query
        if (missingIds.length > 0) {
            const placeholders = missingIds.map(() => '?').join(',');
            const players = await queryAll(
                `SELECT pid, player_img FROM ${TABLES.CRICKET_PLAYERS} WHERE pid IN (${placeholders})`,
                missingIds
            );

            const toCache = {};
            players.forEach(p => {
                const img = p.player_img || 'https://onex11.com/playerProfile.png';
                result[p.pid] = img;
                toCache[CACHE_KEYS.PLAYER_IMAGE(p.pid)] = img;
            });

            if (Object.keys(toCache).length > 0) {
                await cache.mset(toCache, CACHE_EXPIRY.WEEK(4));
            }

            missingIds.forEach(pid => {
                if (!result[pid]) {
                    result[pid] = 'https://onex11.com/playerProfile.png';
                }
            });
        }

        return result;
    } catch (error) {
        logError(error, { context: 'getBatchPlayerImages' });
        return {};
    }
};

/**
 * Get user's teams with ALL data
 */
const getUserTeams = async (matchId, userId, teamIds = null, type = null) => {
    try {
        let whereClause = 'ct.match_id = ? AND ct.user_id = ?';
        let params = [matchId, userId];

        if (type === 'close' && teamIds?.length) {
            whereClause += ` AND ct.id IN (${teamIds.map(() => '?').join(',')})`;
            params.push(...teamIds);
        } else if (type === 'open' && teamIds?.length) {
            whereClause += ` AND ct.id IN (${teamIds.map(() => '?').join(',')})`;
            params.push(...teamIds);
        }

        const query = `
            SELECT 
                ct.id as team_id,
                ct.match_id,
                ct.user_id,
                ct.team_id as player_team_ids,
                ct.teams as player_pids,
                ct.captain,
                ct.vice_captain,
                ct.team_count,
                ct.points,
                ct.rank,
                
                u.name as user_name,
                u.team_name as user_team_name,
                
                ta.team_id as team_a_id,
                ta.short_name as team_a_short_name,
                
                tb.team_id as team_b_id,
                tb.short_name as team_b_short_name,
                
                -- Get player data as JSON
                (SELECT JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'id', p.id,
                        'pid', p.pid,
                        'short_name', p.short_name,
                        'playing_role', p.playing_role,
                        'team_id', p.team_id
                    )
                )
                FROM ${TABLES.PLAYERS} p
                WHERE p.match_id = ct.match_id
                AND JSON_CONTAINS(ct.teams, CAST(p.pid AS JSON), '$')
                ) as players_data,
                
                -- Count not playing players
                (SELECT COUNT(*)
                 FROM ${TABLES.TEAM_A_SQUADS} tas
                 WHERE tas.match_id = ct.match_id
                 AND JSON_CONTAINS(ct.teams, CAST(tas.player_id AS JSON), '$')
                 AND tas.playing11 = 'false'
                ) +
                (SELECT COUNT(*)
                 FROM ${TABLES.TEAM_B_SQUADS} tbs
                 WHERE tbs.match_id = ct.match_id
                 AND JSON_CONTAINS(ct.teams, CAST(tbs.player_id AS JSON), '$')
                 AND tbs.playing11 = 'false'
                ) as not_playing_count,
                
                -- Check if playing11 announced
                (SELECT COUNT(*) > 0
                 FROM ${TABLES.TEAM_A_SQUADS} tas2
                 WHERE tas2.match_id = ct.match_id
                 AND tas2.playing11 = 'true'
                 LIMIT 1
                ) as has_playing11
                
            FROM ${TABLES.CREATE_TEAMS} ct
            
            INNER JOIN ${TABLES.USERS} u ON ct.user_id = u.id
            
            LEFT JOIN ${TABLES.TEAM_A} ta ON ct.match_id = ta.match_id
            LEFT JOIN ${TABLES.TEAM_B} tb ON ct.match_id = tb.match_id
            
            WHERE ${whereClause}
            
            ORDER BY ct.id DESC
        `;

        const teams = await queryAll(query, params);
        return teams;
    } catch (error) {
        logError(error, { context: 'getUserTeamsOptimized', matchId, userId });
        return [];
    }
};

/**
 * Transform team data
 */
const transformTeamData = async (team, playerImages) => {
    try {
        let playersData;

        if (typeof team.players_data === "string") {
            playersData = JSON.parse(team.players_data || '[]');
        } else {
            playersData = team.players_data || [];
        }

        if (!playersData || playersData.length === 0) {
            return null;
        }

        const teamRoles = {
            bat: [],
            bowl: [],
            all: [],
            wk: []
        };

        let teamACount = 0;
        let teamBCount = 0;

        playersData.forEach(player => {
            if (player.team_id === team.team_a_id) teamACount++;
            if (player.team_id === team.team_b_id) teamBCount++;

            let role = player.playing_role;

            if (role === 'cap') {
                teamRoles.bat.push(player.pid);
            } else if (role === 'wkcap' || role === 'wkbat') {
                teamRoles.wk.push(player.pid);
            } else if (role === 'bat') {
                teamRoles.bat.push(player.pid);
            } else if (role === 'bowl') {
                teamRoles.bowl.push(player.pid);
            } else if (role === 'all') {
                teamRoles.all.push(player.pid);
            } else if (role === 'wk') {
                teamRoles.wk.push(player.pid);
            }
        });

        // Get captain and vice-captain names
        const captainPlayer = playersData.find(p => p.pid === parseInt(team.captain));
        const vcPlayer = playersData.find(p => p.pid === parseInt(team.vice_captain));

        const teamName = team.user_team_name || team.user_name;
        return {
            created_team: {
                team_id: team.team_id
            },
            bat: teamRoles.bat,
            bowl: teamRoles.bowl,
            all: teamRoles.all,
            wk: teamRoles.wk,
            c: {
                pid: parseInt(team.captain),
                name: captainPlayer?.short_name || ''
            },
            vc: {
                pid: parseInt(team.vice_captain),
                name: vcPlayer?.short_name || captainPlayer?.short_name || ''
            },
            match: [`${team.team_a_short_name}-${team.team_b_short_name}`],
            team: [
                { name: team.team_a_short_name, count: teamACount },
                { name: team.team_b_short_name, count: teamBCount }
            ],
            c_img: playerImages[team.captain] || 'https://onex11.com/playerProfile.png',
            vc_img: playerImages[team.vice_captain] || 'https://onex11.com/playerProfile.png',
            t_img: '',
            team_name: `${teamName}(${team.team_count})`,
            points: team.points,
            rank: team.rank,
            not_playing: team.has_playing11 ? team.not_playing_count : 0
        };
    } catch (error) {
        logError(error, { context: 'transformTeamData', teamId: team.team_id });
        return null;
    }
};

/**
 * Get match status and time
 */
const getMatchStatusTime = async (matchId) => {
    try {
        const match = await queryOne(
            `SELECT status, status_str, timestamp_start FROM ${TABLES.MATCHES} WHERE match_id = ? LIMIT 1`,
            [matchId]
        );

        return match ? {
            status: match.status,
            match_status: match.status_str,
            match_time: match.timestamp_start
        } : {
            status: null,
            match_status: null,
            match_time: null
        };
    } catch (error) {
        logError(error, { context: 'getMatchStatusTime', matchId });
        return { status: null, match_status: null, match_time: null };
    }
};

/**
 * Main function: Get My Teams
 */
const getMyTeams = async (matchId, userId, options = {}) => {
    const startTime = Date.now();
    const { type, close_team_id, open_team_id } = options;

    try {
        const [user, match] = await Promise.all([
            queryOne(`SELECT id, name, team_name FROM ${TABLES.USERS} WHERE id = ? LIMIT 1`, [userId]),
            queryOne(`SELECT match_id, status FROM ${TABLES.MATCHES} WHERE match_id = ? LIMIT 1`, [matchId])
        ]);

        if (!user || !match) {
            return {
                status: false,
                code: 201,
                message: 'user id or match id is invalid'
            };
        }

        const isFiltered = type === 'close' || type === 'open';
        const cacheTTL = (match.status === MATCH_STATUS.COMPLETED || match.status === MATCH_STATUS.ABANDONED) ? CACHE_EXPIRY.ONE_DAY : 60;
        const feedCacheKey = `${CACHE_KEYS.MY_TEAMS(matchId, userId)}:${type || 'all'}`;

        if (isFiltered) {
            return await fetchAndTransformTeams(matchId, userId, type, close_team_id, open_team_id);
        }

        return await cache.cacheAside(
            feedCacheKey,
            async () => {
                return await fetchAndTransformTeams(matchId, userId, type, close_team_id, open_team_id);
            },
            cacheTTL
        );
    } catch (error) {
        logError(error, { context: 'getMyTeams', matchId, userId });

        return {
            system_time: Math.floor(Date.now() / 1000),
            status: false,
            code: 500,
            message: 'Failed to fetch my teams',
            _meta: {
                processing_time_ms: Date.now() - startTime,
                error: true
            }
        };
    }
};

/**
 * Helper: Fetch and transform teams
 */
const fetchAndTransformTeams = async (matchId, userId, type, closeTeamIds, openTeamIds) => {
    const startTime = Date.now();

    const teamIds = type === 'close' ? closeTeamIds : type === 'open' ? openTeamIds : null;

    const [teams, matchStatusTime] = await Promise.all([
        getUserTeams(matchId, userId, teamIds, type),
        getMatchStatusTime(matchId),
        // getPlaying11Squad(matchId)
    ]);

    if (teams.length === 0) {
        return {
            system_time: Math.floor(Date.now() / 1000),
            match_status: matchStatusTime.match_status,
            match_time: matchStatusTime.match_time,
            status: true,
            code: 200,
            teamCount: 0,
            message: 'success',
            response: {
                myteam: []
            }
        };
    }

    const allPlayerIds = new Set();
    teams.forEach(team => {
        allPlayerIds.add(parseInt(team.captain));
        allPlayerIds.add(parseInt(team.vice_captain));
        team.players_data.forEach(player => {
            allPlayerIds.add(parseInt(player.id));
        });
    });

    const playerImages = await getBatchPlayerImages([...allPlayerIds]);
    const transformedTeams = await Promise.all(
        teams.map(team => transformTeamData(team, playerImages))
    );

    const validTeams = transformedTeams.filter(t => t !== null);

    const result = {
        system_time: Math.floor(Date.now() / 1000),
        match_status: matchStatusTime.match_status,
        match_time: matchStatusTime.match_time,
        status: true,
        code: 200,
        teamCount: validTeams.length,
        message: 'success',
        response: {
            myteam: validTeams
        },
        _meta: {
            processing_time_ms: Date.now() - startTime,
        }
    };

    logger.info('My teams generated', {
        matchId,
        userId,
        teamCount: validTeams.length,
        duration: Date.now() - startTime
    });

    return result;
};

module.exports = {
    getMyTeams
};