const cache = require('../utils/cache');
const { queryAll, queryOne, executeTransaction } = require('../config/database');
const { TABLES } = require('../utils/tablesNames');
const { CACHE_KEYS, CACHE_EXPIRY, CRICKET } = require('../utils/constants');
const { logError, logger } = require('../utils/logger');
const { MATCH_STATUS, PLAYER_ROLES, MATCH_FORMAT } = CRICKET;

/**
 * Team composition rules by match format
 */
const TEAM_RULES = {
    6: { // 6-a-side
        total: 6,
        minPlayers: 6,
        maxPlayers: 6
    },
    11: { // Standard
        total: 11,
        minPlayers: 11,
        maxPlayers: 11,
        roleConstraints: {
            [PLAYER_ROLES.BATSMAN]: { min: 1, max: 8 },
            [PLAYER_ROLES.BOWLER]: { min: 1, max: 8 },
            [PLAYER_ROLES.ALL_ROUNDER]: { min: 1, max: 8 },
            [PLAYER_ROLES.WICKET_KEEPER]: { min: 1, max: 8 }
        }
    }
};

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
 * Get match status and time
 */
const getMatchStatusTime = async (matchId) => {
    try {
        const match = await getMatchMetadata(matchId);

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
        const feedCacheKey = `${CACHE_KEYS.USER_TEAMS(matchId, userId)}:${type || 'all'}`;

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

/* --------------------------------- Create Team --------------------------------- */

/**
 * Check if user has reached team creation limit
 */
const checkTeamCreationLimit = async (matchId, userId) => {
    const cacheKey = CACHE_KEYS.USER_TEAM_COUNT(matchId, userId);

    const teamCount = await cache.cacheAside(
        cacheKey,
        async () => {
            const result = await queryOne(`
                SELECT COUNT(1) as count 
                FROM ${TABLES.CREATE_TEAMS} 
                WHERE match_id = ? 
                AND user_id = ?`,
                [matchId, userId]
            );

            return result?.count || 0;
        },
        CACHE_EXPIRY.ONE_HOUR
    );

    return teamCount >= 20;
};

/**
 * Validate players and get their roles
 */
const validatePlayers = async (matchId, playerIds) => {
    if (!playerIds.length) return { valid: false, players: [] };

    const cacheKey = CACHE_KEYS.MATCH_PLAYERS(matchId);

    const players = await cache.cacheAside(
        cacheKey,
        async () => {
            const playerData = await queryAll(`
                SELECT pid, playing_role, team_id 
                FROM ${TABLES.PLAYERS} 
                WHERE match_id = ?`,
                [matchId]
            );

            return playerData;
        },
        CACHE_EXPIRY.ONE_DAY
    );

    const playerLookup = {};
    players.forEach(player => {
        playerLookup[player.pid] = player;
    });

    const validPlayers = [];
    for (const playerId of playerIds) {
        const player = playerLookup[playerId];
        if (!player) {
            return { valid: false, error: `Invalid player ID: ${playerId}` };
        }
        validPlayers.push(player);
    }

    return { valid: true, players: validPlayers };
};

/**
 * Validate team composition rules
 */
const validateTeamComposition = (players, captainId, viceCaptainId, matchFormat) => {
    const teamSize = [17, 21].includes(matchFormat) ? 6 : 11;
    const rules = TEAM_RULES[teamSize];

    if (players.length !== rules.total) {
        return { valid: false, error: `Team must have exactly ${rules.total} players` };
    }

    if (captainId === viceCaptainId) {
        return { valid: false, error: 'Captain and Vice-Captain cannot be the same player' };
    }

    if (rules.roleConstraints) {
        const roleCount = {};

        players.forEach(player => {
            roleCount[player.playing_role] = (roleCount[player.playing_role] || 0) + 1;
        });

        for (const [role, constraints] of Object.entries(rules.roleConstraints)) {
            const count = roleCount[role] || 0;
            if (count < constraints.min || count > constraints.max) {
                return {
                    valid: false,
                    error: `${role} count must be between ${constraints.min} and ${constraints.max}`
                };
            }
        }
    }

    return { valid: true };
};

/**
 * Check for duplicate team (same players, captain, vice-captain)
 */
const checkDuplicateTeam = async (matchId, userId, playerIds, captainId, viceCaptainId) => {
    const teamHash = createTeamHash(playerIds, captainId, viceCaptainId);

    const cacheKey = CACHE_KEYS.TEAM_HASH(matchId, userId, teamHash);
    const exists = await cache.get(cacheKey);

    if (exists) return true;

    const existingTeam = await queryOne(`
        SELECT id FROM ${TABLES.CREATE_TEAMS} 
        WHERE match_id = ? 
        AND user_id = ? 
        AND team_hash = ? 
        LIMIT 1`,
        [matchId, userId, teamHash]
    );

    if (existingTeam) {
        await cache.set(cacheKey, true, CACHE_EXPIRY.ONE_DAY);
        return true;
    }

    return false;
};

/**
 * Create unique hash for team combination
 */
const createTeamHash = (playerIds, captainId, viceCaptainId) => {
    const sortedPlayers = [...playerIds].sort((a, b) => a - b);
    return `${sortedPlayers.join(',')}|${captainId}|${viceCaptainId}`;
};

/**
 * Create team in database
 */
const createTeamRecord = async (teamData, isUpdate = false) => {
    return await executeTransaction(async (connection) => {
        const now = new Date();
        const teamHash = createTeamHash(teamData.teams, teamData.captain, teamData.vice_captain);

        if (isUpdate) {
            await connection.execute(`
                UPDATE ${TABLES.CREATE_TEAMS} 
                SET teams = '${JSON.stringify(teamData.teams)}', captain = '${teamData.captain}', vice_captain = '${teamData.vice_captain}', team_hash = '${teamHash}', update_team_time = '${now}', edit_team_count = edit_team_count + 1
                WHERE id = '${teamData.create_team_id}' AND user_id = '${teamData.user_id}'`,
            );

            return teamData.create_team_id;
        } else {
            let teamCount = 0;
            const cacheKey = CACHE_KEYS.USER_TEAM_COUNT(teamData.match_id, teamData.user_id);
            const cachedTeamCount = await cache.get(cacheKey);

            if (!cachedTeamCount) {
                const count = await connection.execute(`
                    SELECT COUNT(1) as count 
                    FROM ${TABLES.CREATE_TEAMS} 
                    WHERE match_id = ? AND user_id = ?`,
                    [teamData.match_id, teamData.user_id]
                );

                teamCount = count[0][0]?.count || 0;
                await cache.set(cacheKey, teamCount + 1, CACHE_EXPIRY.ONE_HOUR);
            } else {
                teamCount = cachedTeamCount;
            }

            const teamNumber = `T${teamCount + 1}`;

            const result = await connection.execute(`
                INSERT INTO ${TABLES.CREATE_TEAMS} 
                (match_id, user_id, teams, captain, vice_captain, team_hash,
                 team_count, create_team_time, update_team_time, expert_user_id,
                 expert_team_id, contest_id, edit_team_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    teamData.match_id,
                    teamData.user_id,
                    JSON.stringify(teamData.teams),
                    teamData.captain,
                    teamData.vice_captain,
                    teamHash,
                    teamNumber,
                    now,
                    now,
                    teamData.expert_user_id || 0,
                    teamData.expert_team_id || 0,
                    teamData.contest_id || 0,
                    0
                ]
            );

            return result[0].insertId;
        }
    });
};

/**
 * Update player analytics (non-blocking)
 */
const updatePlayerAnalytics = async (teamData, teamId) => {
    setImmediate(async () => {
        try {
            await executeTransaction(async (connection) => {
                await connection.execute(`
                    DELETE FROM ${TABLES.PLAYER_ANALYTICS} 
                    WHERE created_team_id = ? AND user_id = ?`,
                    [teamId, teamData.user_id]
                );

                const analyticsData = teamData.teams.map(playerId => [
                    teamData.match_id,
                    teamId,
                    playerId,
                    teamData.captain,
                    teamData.vice_captain,
                    0, // customer_type
                    teamData.user_id,
                    new Date()
                ]);

                if (analyticsData.length > 0) {
                    await connection.query(`
                        INSERT INTO ${TABLES.PLAYER_ANALYTICS} 
                        (match_id, created_team_id, player_id, captain, vice_captain, customer_type, user_id, created_at)
                        VALUES ?`,
                        [analyticsData]
                    );
                }
            });
        } catch (error) {
            logError(error, {
                context: 'updatePlayerAnalytics',
                teamId,
                userId: teamData.user_id
            });
        }
    });
};

/**
 * Invalidate relevant caches
 */
const invalidateCaches = async (matchId, userId) => {
    const cacheKeys = [
        CACHE_KEYS.USER_TEAMS(matchId, userId),
    ];

    try {
        await Promise.allSettled(
            cacheKeys.map(key => cache.del(key))
        );
    } catch (error) {
        logError(error, { context: 'invalidateCaches', matchId, userId });
    }
};

/**
 * Main function: Create or update team
 */
const createTeam = async (teamData) => {
    const startTime = Date.now();
    const { match_id, user_id, teams, captain, vice_captain, create_team_id, trace_id } = teamData;

    try {
        logger.info('Team creation started', {
            traceId: trace_id,
            matchId: match_id,
            userId: user_id,
            isUpdate: !!create_team_id
        });

        const [match, teamLimitReached] = await Promise.all([
            getMatchMetadata(match_id),
            checkTeamCreationLimit(match_id, user_id)
        ]);

        if (!match) {
            return {
                system_time: Math.floor(Date.now() / 1000),
                status: false,
                code: 201,
                message: 'Match not found'
            };
        }

        const currentTime = Math.floor(Date.now() / 1000);
        if (currentTime > match.timestamp_start) {
            return {
                system_time: currentTime,
                status: false,
                code: 201,
                message: 'Match time up'
            };
        }

        if (!create_team_id && teamLimitReached) {
            return {
                system_time: currentTime,
                status: false,
                code: 201,
                message: 'Max create team limit exceeded (20 teams)'
            };
        }

        const playerValidation = await validatePlayers(match_id, teams);
        if (!playerValidation.valid) {
            return {
                system_time: currentTime,
                status: false,
                code: 201,
                message: playerValidation.error
            };
        }

        const compositionValidation = validateTeamComposition(
            playerValidation.players,
            captain,
            vice_captain,
            match.format
        );

        if (!compositionValidation.valid) {
            return {
                system_time: currentTime,
                status: false,
                code: 201,
                message: compositionValidation.error
            };
        }

        if (!create_team_id) {
            const isDuplicate = await checkDuplicateTeam(match_id, user_id, teams, captain, vice_captain);
            if (isDuplicate) {
                return {
                    system_time: currentTime,
                    status: false,
                    code: 201,
                    message: 'You have already created this team combination'
                };
            }
        }

        const teamId = await createTeamRecord(teamData, !!create_team_id);

        Promise.allSettled([
            updatePlayerAnalytics(teamData, teamId),
            invalidateCaches(match_id, user_id)
        ]).catch(err => {
            logError(err, {
                context: 'createTeamBackgroundOps',
                teamId,
                userId: user_id
            });
        });

        const response = {
            system_time: currentTime,
            match_status: match.status_str,
            match_time: match.timestamp_start,
            status: true,
            code: 200,
            message: 'Team created successfully',
            response: {
                create_team_id: teamId,
                team_count: create_team_id ? undefined : `T${await getTeamCount(match_id, user_id)}`
            },
            _meta: {
                processing_time_ms: Date.now() - startTime,
                trace_id: trace_id,
            }
        };

        logger.info('Team creation completed', {
            traceId: trace_id,
            matchId: match_id,
            userId: user_id,
            teamId: teamId,
            duration: Date.now() - startTime
        });

        return response;

    } catch (error) {
        logError(error, {
            context: 'createTeam',
            traceId: trace_id,
            matchId: match_id,
            userId: user_id
        });

        return {
            system_time: Math.floor(Date.now() / 1000),
            status: false,
            code: 500,
            message: 'Failed to create team',
            _meta: {
                processing_time_ms: Date.now() - startTime,
                error: true,
                trace_id: trace_id
            }
        };
    }
};

/**
 * Get user's team count for this match
 */
const getTeamCount = async (matchId, userId) => {
    const cacheKey = CACHE_KEYS.USER_TEAM_COUNT(matchId, userId);
    const teamCount = await cache.cacheAside(
        cacheKey,
        async () => {
            return await queryOne(`
                SELECT COUNT(1) as count 
                FROM ${TABLES.CREATE_TEAMS} 
                WHERE match_id = ? AND user_id = ?`,
                [matchId, userId]
            );
        },
        CACHE_EXPIRY.ONE_HOUR
    );

    return teamCount?.count || 0;
};


module.exports = {
    createTeam,
    getMyTeams
};