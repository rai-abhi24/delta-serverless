/**
 * Contest Service - Handles operations related to contests
 */

const config = require('../config');
const cache = require('../utils/cache');
const { CACHE_KEYS, CACHE_EXPIRY, MATCH_STATUS } = require('../utils/constants');
const { queryAll, queryOne, executeTransaction } = require('../config/database');
const { logError, logger } = require('../utils/logger');
const { TABLES } = require('../utils/tablesNames');

/**
 * Validate match and check if it's still open for joining
 */
const validateMatchTiming = async (matchId) => {
    try {
        const cacheKey = CACHE_KEYS.MATCH_META(matchId);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const match = await queryOne(`
                    SELECT match_id, timestamp_start, status, status_str 
                    FROM ${TABLES.MATCHES} 
                    WHERE match_id = ? 
                    LIMIT 1`,
                    [matchId]
                );

                return match;
            },
            CACHE_EXPIRY.ONE_DAY
        );
    } catch (error) {
        logError(error, { context: 'validateMatchTiming', matchId });
        return null;
    }
};

/**
 * Get contests for a match with max 3 contests per type
 */
const getMatchContestsByType = async (matchId) => {
    try {
        const cacheKey = CACHE_KEYS.CONTEST_CATALOG(matchId);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const query = `
                    WITH RankedContests AS (
                        SELECT 
                            cc.id as contest_id, 
                            cc.contest_type, 
                            cc.entry_fees, 
                            cc.mrp as max_fees, 
                            cc.total_spots, 
                            cc.filled_spot, 
                            cc.fake_counter, 
                            cc.total_winning_prize, 
                            cc.first_prize, 
                            cc.winner_percentage,
                            cc.prize_percentage, 
                            cc.usable_bonus, 
                            cc.bonus_contest, 
                            cc.is_flexible, 
                            cc.is_bte, 
                            cc.is_cancelled, 
                            cc.cancellation, 
                            cc.sort_by, 
                            cc.extra_cash, 
                            cc.expert_id,
                            
                            -- Expert image if BTE contest
                            CASE 
                                WHEN cc.is_bte = 1 THEN fe.expert_image
                                ELSE NULL
                            END as expert_image,
                            
                            -- Contest type details
                            ct.contest_type as contest_title,
                            ct.description as contest_subtitle,
                            ct.max_entries,
                            ct.tnc_url,
                            ct.inv_url,
                            ct.free_wheel_count,
                            
                            -- Count total contests of this type
                            (SELECT COUNT(*) 
                             FROM ${TABLES.CREATE_CONTESTS} cc2
                             WHERE cc2.match_id = '${matchId}'
                             AND cc2.contest_type = cc.contest_type
                             AND cc2.is_cancelled = 0
                             AND cc2.is_private = 0
                             AND cc2.filled_spot < cc2.total_spots
                            ) as type_total_count,
                            
                            -- Row number per contest type for limiting
                            ROW_NUMBER() OVER (
                                PARTITION BY cc.contest_type 
                                ORDER BY 
                                    cc.sort_by ASC,
                                    cc.filled_spot DESC,
                                    cc.id ASC
                            ) as type_rank
                            
                        FROM ${TABLES.CREATE_CONTESTS} cc
                        
                        INNER JOIN ${TABLES.CONTEST_TYPES} ct 
                            ON cc.contest_type = ct.id
                        
                        LEFT JOIN ${TABLES.FANTASY_EXPERTS} fe
                            ON cc.expert_id = fe.user_id AND cc.is_bte = 1
                        
                        WHERE cc.match_id = '${matchId}'
                        AND cc.is_cancelled = 0
                        AND cc.is_private = 0
                        AND cc.filled_spot < cc.total_spots
                    )
                    SELECT * FROM RankedContests 
                    WHERE type_rank <= 3
                    ORDER BY 
                        contest_type ASC,
                        type_rank ASC
                `;

                const contests = await queryAll(query);

                const typeCountResult = await queryOne(`
                    SELECT COUNT(DISTINCT contest_type) as total_types
                    FROM ${TABLES.CREATE_CONTESTS}
                    WHERE match_id = ?
                    AND is_cancelled = 0
                    AND is_private = 0
                    AND filled_spot < total_spots`,
                    [matchId]
                );

                return {
                    contests,
                    total: typeCountResult?.total_types || 0
                };
            },
            CACHE_EXPIRY.TWO_MINUTES
        );
    } catch (error) {
        logError(error, { context: 'getMatchContestsByType', matchId });
        return { contests: [], total: 0 };
    }
};

/**
 * Get user's joined contests for a match (optimized single query)
 */
const getUserJoinedContests = async (matchId, userId) => {
    try {
        const cacheKey = CACHE_KEYS.USER_CONTESTS(matchId, userId);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const query = `
                    SELECT 
                        jc.contest_id,
                        COUNT(jc.id) as teams_joined,
                        GROUP_CONCAT(jc.created_team_id) as team_ids
                    FROM ${TABLES.JOIN_CONTESTS} jc
                    WHERE jc.match_id = ?
                    AND jc.user_id = ?
                    GROUP BY jc.contest_id
                `;

                const joined = await queryAll(query, [matchId, userId]);

                const joinedMap = {};
                joined.forEach(item => {
                    joinedMap[item.contest_id] = {
                        count: item.teams_joined,
                        teamIds: item.team_ids ? item.team_ids.split(',') : []
                    };
                });

                return joinedMap;
            },
            CACHE_EXPIRY.ONE_MINUTE
        );
    } catch (error) {
        logError(error, { context: 'getUserJoinedContests', matchId, userId });
        return {};
    }
};

/**
 * Get user's total teams for the match
 */
const getUserTeamCount = async (matchId, userId) => {
    try {
        const cacheKey = CACHE_KEYS.USER_TEAMS(matchId, userId);

        return await cache.cacheAside(
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
            CACHE_EXPIRY.ONE_MINUTE
        );
    } catch (error) {
        logError(error, { context: 'getUserTeamCount', matchId, userId });
        return 0;
    }
};

/**
 * Get user's joined contest count
 */
const getUserJoinedContestCount = async (matchId, userId) => {
    try {
        const result = await queryOne(`
            SELECT COUNT(DISTINCT contest_id) as count 
            FROM ${TABLES.JOIN_CONTESTS}
            WHERE match_id = ? 
            AND user_id = ?`,
            [matchId, userId]
        );

        return result?.count || 0;
    } catch (error) {
        logError(error, { context: 'getUserJoinedContestCount', matchId, userId });
        return 0;
    }
};

/**
 * Transform contest data with calculations
 */
const transformContest = (contest, userJoinedData, userId) => {
    let filledSpots = contest.filled_spot;
    if (contest.total_spots > 500 || contest.is_bte === 1) {
        filledSpots += (contest.fake_counter || 0);
    }

    let totalWinningPrize = contest.total_winning_prize;
    let firstPrize = contest.first_prize;

    if (contest.total_spots === 0) {
        const revenue = contest.filled_spot * contest.entry_fees * 0.7;
        totalWinningPrize = Math.round(revenue);
        firstPrize = Math.round(revenue);

        if (totalWinningPrize < contest.entry_fees) {
            firstPrize = contest.entry_fees;
            totalWinningPrize = contest.filled_spot > 1
                ? contest.entry_fees * (contest.filled_spot - 1)
                : contest.entry_fees;
        }
    }

    const userJoined = userJoinedData[contest.contest_id] || { count: 0 };
    const isUserExpert = contest.is_bte === 1 && contest.expert_id === userId;

    return {
        usable_bonus: contest.usable_bonus,
        bonus_contest: contest.bonus_contest,
        filled_spot: filledSpots,
        sort_by: contest.sort_by,
        extra_cash: contest.extra_cash,
        cancellation: contest.cancellation === "1",
        is_bte: contest.is_bte,
        is_flexible: contest.is_flexible,
        is_private: contest.is_private,
        is_gadget_based: contest.is_gadget_based,
        contest_type_id: contest.contest_type,
        isCancelled: contest.is_cancelled === 1,
        maxAllowedTeam: contest.max_entries,
        totalSpots: contest.total_spots,
        firstPrice: firstPrize,
        totalWinningPrize, totalWinningPrize,
        contestId: contest.contest_id,
        max_fees: contest.max_fees,
        entryFees: contest.entry_fees,
        winnerPercentage: contest.winner_percentage,
        no_of_users_team: isUserExpert ? 1 : userJoined.count,
        winnerCount: contest.prize_percentage,
        ...(contest.is_bte === 1 && contest.expert_image && {
            expert_image: contest.expert_image.startsWith('http')
                ? contest.expert_image
                : `${config.app.baseUrl || 'https://panel.onex11.com'}/${contest.expert_image}`
        })
    };
};

/**
 * Group contests by type and limit to top 3 per type
 */
const groupContestsByType = (contests, userJoinedData, userId) => {
    const grouped = {};

    contests.forEach(contest => {
        const typeId = contest.contest_type;

        if (!grouped[typeId]) {
            grouped[typeId] = {
                contest_type_id: typeId,
                contestTitle: contest.contest_title,
                contestSubTitle: contest.contest_subtitle,
                free_wheel_count: contest.free_wheel_count,
                tnc_url: contest.tnc_url,
                inv_url: contest.inv_url,
                total_contest_count: contest.type_total_count,
                is_bte: contest.is_bte,
                is_flexible: contest.is_flexible,
                totalWinningPrize: contest.total_winning_prize,
                contests: []
            };
        }

        grouped[typeId].contests.push(
            transformContest(contest, userJoinedData, userId)
        );
    });

    return Object.values(grouped).sort((a, b) => b.totalWinningPrize - a.totalWinningPrize);
};

/**
 * Main function: Get contests by match
 * Optimized to reduce from 20+ queries to just 4-5 queries
 */
const getContestsByMatch = async (matchId, userId, page = 1) => {
    const startTime = Date.now();

    try {
        const feedCacheKey = CACHE_KEYS.CONTEST_FEED(matchId, page);
        const cached = await cache.get(feedCacheKey);
        if (cached) {
            logger.info('Contest feed served from cache', { matchId, userId, page });
            return cached;
        }

        const match = await validateMatchTiming(matchId);

        if (!match) {
            return {
                system_time: Math.floor(Date.now() / 1000),
                status: false,
                code: 201,
                message: 'Match id is invalid'
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

        const [
            { contests, total },
            userJoinedData,
            userTeamCount,
            userContestCount
        ] = await Promise.all([
            getMatchContestsByType(matchId),
            getUserJoinedContests(matchId, userId),
            getUserTeamCount(matchId, userId),
            getUserJoinedContestCount(matchId, userId)
        ]);

        logger.info(`Contest feed generated ${JSON.stringify({
            contests,
            userJoinedData,
            userTeamCount,
            userContestCount
        })}`);

        const groupedContests = groupContestsByType(contests, userJoinedData, userId);
        const contestsPerPage = 10;
        const totalPages = Math.ceil(total / contestsPerPage);

        const result = {
            session_expired: false,
            system_time: currentTime,
            match_status: match.status_str,
            match_time: match.timestamp_start,
            status: true,
            code: 200,
            message: 'Success',
            response: {
                matchcontests: groupedContests,
                myjoinedTeams: userTeamCount,
                myjoinedContest: userContestCount
            },
            pagination: {
                current_page: page,
                total_pages: totalPages,
                total_contests: total
            },
            _meta: {
                processing_time_ms: Date.now() - startTime,
                cache_status: 'miss',
                version: 'v2'
            }
        };

        await cache.set(feedCacheKey, result, 30);

        // setImmediate(() => {
        //     autoCreateContests(matchId).catch(err =>
        //         logError(err, { context: 'autoCreateContests', matchId })
        //     );
        // });

        logger.info('Contest feed generated', {
            matchId,
            userId,
            contestCount: contests.length,
            groupCount: groupedContests.length,
            duration: Date.now() - startTime
        });

        return result;

    } catch (error) {
        logError(error, { context: 'getContestsByMatch', matchId, userId });

        return {
            system_time: Math.floor(Date.now() / 1000),
            status: false,
            code: 500,
            message: 'Failed to fetch contests',
            _meta: {
                processing_time_ms: Date.now() - startTime,
                error: true
            }
        };
    }
};

/* ---------------- Get All Contests By Match ---------------- */

const getMatchContests = async (matchId, page = 1, limit = 10) => {
    const cacheKey = CACHE_KEYS.MATCH_CONTESTS(matchId, page, limit);
    try {
        const cached = await cache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const offset = (page - 1) * limit;

        const query = `
            SELECT 
                cc.id as contest_id, cc.contest_type, cc.entry_fees, cc.mrp as max_fees, 
                cc.total_spots, cc.filled_spot, cc.fake_counter, cc.total_winning_prize, 
                cc.first_prize, cc.winner_percentage, cc.prize_percentage, cc.is_private,
                cc.usable_bonus, cc.bonus_contest, cc.is_flexible, cc.is_bte, cc.is_cancelled, 
                cc.cancellation, cc.sort_by, cc.extra_cash, cc.expert_id, cc.is_gadget_based,
                
                CASE 
                    WHEN cc.is_bte = 1 THEN fe.expert_image
                    ELSE NULL
                END as expert_image,
                
                ct.contest_type as contest_title,
                ct.description as contest_subtitle,
                ct.max_entries,
                ct.tnc_url,
                ct.inv_url,
                ct.free_wheel_count
                
            FROM ${TABLES.CREATE_CONTESTS} cc
            
            INNER JOIN ${TABLES.CONTEST_TYPES} ct 
                ON cc.contest_type = ct.id
            
            LEFT JOIN ${TABLES.FANTASY_EXPERTS} fe
                ON cc.expert_id = fe.user_id AND cc.is_bte = 1
            
            WHERE cc.match_id = '${matchId}'
            AND cc.is_cancelled = 0
            AND cc.is_private = 0
            AND cc.filled_spot < cc.total_spots
            AND cc.deleted_at IS NULL
            
            ORDER BY cc.sort_by ASC, cc.entry_fees DESC
            
            LIMIT ${limit} OFFSET ${offset}
        `;

        const contests = await queryAll(query);

        const countResult = await queryOne(`
            SELECT COUNT(*) as total 
            FROM ${TABLES.CREATE_CONTESTS}
            WHERE match_id = ?
            AND is_cancelled = 0
            AND is_private = 0
            AND filled_spot < total_spots
            AND deleted_at IS NULL`,
            [matchId]
        );

        await cache.set(cacheKey, { contests, total: countResult?.total || 0 }, CACHE_EXPIRY.ONE_MINUTE);
        return {
            contests,
            total: countResult?.total || 0
        };
    } catch (error) {
        logError(error, { context: 'getMatchContests', matchId });
        return { contests: [], total: 0 };
    }
};

const getAllContestsByMatch = async (matchId, userId, page = 1) => {
    try {
        const perPage = 20;
        const match = await validateMatchTiming(matchId);

        if (!match) {
            return {
                system_time: Math.floor(Date.now() / 1000),
                status: false,
                code: 201,
                message: 'Match id is invalid'
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

        const [
            { contests, total },
            userJoinedData
        ] = await Promise.all([
            getMatchContests(matchId, page, perPage),
            getUserJoinedContests(matchId, userId)
        ]);

        const transformedContests = contests.map(contest =>
            transformContest(contest, userJoinedData, userId)
        );

        const totalPages = Math.ceil(total / perPage);

        return {
            session_expired: false,
            system_time: currentTime,
            match_status: match.status_str,
            match_time: match.timestamp_start,
            status: true,
            code: 200,
            message: 'Success',
            response: {
                matchcontests: transformedContests
            },
            pagination: {
                current_page: page,
                total_pages: totalPages
            }
        };
    } catch (error) {
        logError(error, { context: 'getAllContestsByMatch', matchId, userId });
        return {
            system_time: Math.floor(Date.now() / 1000),
            status: false,
            code: 500,
            message: 'Failed to fetch contests'
        };
    }
};

/* --------------------- Get My Contests --------------------- */

/**
 * Process pending join contests (non-blocking)
 */
const processPendingContests = async (matchId, userId, contestId = null) => {
    try {
        await executeTransaction(async (connection) => {
            const query = `
                SELECT * FROM ${TABLES.PENDING_JOIN_CONTESTS}
                WHERE match_id = ? AND user_id = ?
                ${contestId ? 'AND contest_id = ?' : ''}
                AND status = 0
                FOR UPDATE
            `;
            const params = contestId ? [matchId, userId, contestId] : [matchId, userId];

            const [jobs] = await connection.execute(query, params);

            if (jobs.length === 0) return;

            for (const job of jobs) {
                await connection.execute(
                    `UPDATE ${TABLES.PENDING_JOIN_CONTESTS} SET status = 1 WHERE id = ?`,
                    [job.id]
                );

                const payload = JSON.parse(job.payload);

                if (payload.updateStatementsEXT?.length) {
                    await connection.query(
                        `INSERT INTO ${TABLES.WALLET_TRANSACTIONS} 
                        (user_id, match_id, contest_id, amount, type, created_at, updated_at) VALUES ?`,
                        [payload.updateStatementsEXT.map(s => Object.values(s))]
                    );
                }

                if (payload.updateStatementsWTD?.length) {
                    await connection.query(
                        `INSERT INTO ${TABLES.WALLET_TRANSACTIONS} 
                        (user_id, match_id, contest_id, amount, type, created_at, updated_at) VALUES ?`,
                        [payload.updateStatementsWTD.map(s => Object.values(s))]
                    );
                }

                if (payload.updateStatementsBonus?.length) {
                    await connection.query(
                        `INSERT INTO ${TABLES.WALLET_TRANSACTIONS} 
                        (user_id, match_id, contest_id, amount, type, created_at, updated_at) VALUES ?`,
                        [payload.updateStatementsBonus.map(s => Object.values(s))]
                    );
                }

                if (payload.joinContestStatement?.length) {
                    await connection.query(
                        `INSERT INTO ${TABLES.JOIN_CONTESTS} 
                        (user_id, match_id, contest_id, created_team_id, team_count, team_name, entry_fees, points, ranks, created_at, updated_at) VALUES ?`,
                        [payload.joinContestStatement.map(s => Object.values(s))]
                    );
                }
            }
        });

        await Promise.all([
            cache.del(CACHE_KEYS.USER_CONTESTS(matchId, userId)),
            cache.del(CACHE_KEYS.USER_TEAMS(matchId, userId))
        ]);
    } catch (error) {
        logError(error, { context: 'processPendingContests', matchId, userId, contestId });
    }
};

/**
 * Get user's joined contests with teams
 */
const getMyJoinedContestsWithTeams = async (matchId, userId) => {
    try {
        const cacheKey = CACHE_KEYS.MY_CONTESTS(matchId, userId);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const query = `
                    SELECT 
                        jc.id as join_id,
                        jc.contest_id,
                        jc.created_team_id,
                        jc.team_count,
                        jc.team_name,
                        jc.points,
                        jc.ranks as 'rank',
                        jc.winning_amount,
                        jc.cancel_contest,
                        
                        cc.entry_fees,
                        cc.total_spots,
                        cc.filled_spot,
                        cc.fake_counter,
                        cc.total_winning_prize,
                        cc.first_prize,
                        cc.winner_percentage,
                        cc.prize_percentage,
                        cc.usable_bonus,
                        cc.bonus_contest,
                        cc.is_flexible,
                        cc.is_bte,
                        cc.is_cancelled,
                        cc.cancellation,
                        cc.is_private,
                        cc.created_by_user,
                        cc.coupon_code,
                        cc.is_gadget_based,
                        cc.extra_cash,
                        cc.expert_id,
                        cc.mrp as max_fees,
                        cc.sort_by,
                        cc.contest_title,
                        
                        ct.contest_type,
                        ct.description as contest_subtitle,
                        ct.max_entries,
                        ct.tnc_url,
                        ct.inv_url,
                        ct.free_wheel_count,
                        
                        u.name as user_name,
                        
                        CASE 
                            WHEN cc.is_bte = 1 THEN fe.expert_image
                            ELSE NULL
                        END as expert_image,
                        
                        -- Get all teams for this contest in one go
                        (SELECT JSON_ARRAYAGG(
                            JSON_OBJECT(
                                'team_name', CONCAT(COALESCE(jc2.team_name, u.name), '(', jc2.team_count, ')'),
                                'createdTeamId', jc2.created_team_id,
                                'contestId', jc2.contest_id,
                                'isWinning', false,
                                'rank', COALESCE(jc2.ranks),
                                'points', jc2.points,
                                'prize_amount', IF(jc2.cancel_contest = 1, 0, COALESCE(jc2.winning_amount, 0))
                            )
                        )
                        FROM ${TABLES.JOIN_CONTESTS} jc2
                        WHERE jc2.contest_id = cc.id 
                        AND jc2.user_id = jc.user_id
                        AND jc2.match_id = jc.match_id
                        ORDER BY jc2.ranks ASC
                        ) as joined_teams
                        
                    FROM ${TABLES.JOIN_CONTESTS} jc
                    
                    INNER JOIN ${TABLES.CREATE_CONTESTS} cc 
                        ON jc.contest_id = cc.id
                    
                    INNER JOIN ${TABLES.CONTEST_TYPES} ct 
                        ON cc.contest_type = ct.id
                    
                    LEFT JOIN ${TABLES.USERS} u 
                        ON jc.user_id = u.id
                    
                    LEFT JOIN ${TABLES.FANTASY_EXPERTS} fe 
                        ON cc.expert_id = fe.user_id AND cc.is_bte = 1
                    
                    WHERE jc.match_id = ? 
                    AND jc.user_id = ?
                    
                    GROUP BY jc.contest_id
                    ORDER BY cc.sort_by ASC
                `;

                const contests = await queryAll(query, [matchId, userId]);
                return contests;
            },
            CACHE_EXPIRY.FIVE_MINUTES
        );
    } catch (error) {
        logError(error, { context: 'getMyJoinedContestsWithTeams', matchId, userId });
        return [];
    }
};

/**
 * Transform contest data
 */
const transformMyContest = (contest, userId) => {
    logger.info({
        message: 'transformMyContest',
        data: { joined_teams: contest.joined_teams, userId }
    })
    const baseUrl = config.app.baseUrl || 'https://panel.onex11.com';

    // Calculate filled spots
    let filledSpots = contest.filled_spot;
    if (contest.total_spots > 500 || contest.is_bte === 1) {
        filledSpots += (contest.fake_counter || 0);
    }

    // Calculate dynamic prize for flexible contests
    let totalWinningPrize = contest.total_winning_prize;
    let firstPrice = contest.first_prize;

    if (contest.total_spots === 0) {
        const twp = Math.round(contest.filled_spot * contest.entry_fees * 0.7);
        totalWinningPrize = twp;
        firstPrice = twp;
    }

    // Parse joined teams JSON
    let joinedTeams = [];
    try {
        joinedTeams = contest.joined_teams ? JSON.parse(contest.joined_teams) : [];
    } catch (e) {
        logError(e, { context: 'parseJoinedTeams', contestId: contest.contest_id });
    }

    const isPrivateCreator = contest.is_private === 1 && contest.created_by_user === userId;

    return {
        contestId: contest.contest_id,
        contest_type_id: contest.contest_type,

        // Contest metadata
        contestTitle: contest.is_private === 1 ? contest.contest_title : contest.contest_type,
        contestSubTitle: contest.contest_subtitle,
        tnc_url: contest.tnc_url,
        inv_url: contest.inv_url,
        free_wheel_count: contest.free_wheel_count,

        // Contest details
        entryFees: contest.entry_fees,
        max_fees: contest.max_fees,
        totalSpots: contest.total_spots,
        filled_spot: filledSpots,
        filledSpots,
        totalWinningPrize,
        firstPrice,

        // Contest properties
        winnerPercentage: contest.winner_percentage,
        winnerCount: contest.prize_percentage,
        maxAllowedTeam: contest.max_entries,
        maxEntries: contest.max_entries,
        usable_bonus: contest.usable_bonus,

        // Flags
        bonus_contest: contest.bonus_contest === 1,
        is_flexible: contest.is_flexible === 1,
        is_bte: contest.is_bte === 1,
        is_public: 0,
        is_private: contest.is_private,
        is_private_creater: isPrivateCreator ? 1 : 0,
        private_contest_code: contest.coupon_code,
        is_gadget_based: contest.is_gadget_based,
        isCancelled: contest.is_cancelled === 1,
        cancellation: contest.cancellation === 1,

        // Additional fields
        sort_by: contest.sort_by,
        extra_cash: contest.extra_cash,

        // Teams
        no_of_users_team: joinedTeams.length,
        joinedTeams,

        // Expert data
        ...(contest.is_bte === 1 && contest.expert_image && {
            expert_image: contest.expert_image.startsWith('http')
                ? contest.expert_image
                : `${baseUrl}/${contest.expert_image}`
        })
    };
};

/**
 * Main function: Get My Contests
 */
const getMyContests = async (matchId, userId, versionCode = null) => {
    const startTime = Date.now();

    try {
        const match = await validateMatchTiming(matchId);

        if (!match) {
            return {
                system_time: Math.floor(Date.now() / 1000),
                status: false,
                code: 201,
                message: 'match id is invalid'
            };
        }

        if (match.status !== 2) {
            setImmediate(() => {
                processPendingContests(matchId, userId).catch(err =>
                    logError(err, { context: 'processPendingContests', matchId, userId })
                );
            });
        }

        let cacheTTL;
        if (match.status === MATCH_STATUS.COMPLETED || match.status === MATCH_STATUS.ABANDONED) {
            cacheTTL = CACHE_EXPIRY.ONE_DAY;
        } else if (match.status === MATCH_STATUS.LIVE) {
            cacheTTL = 45;
        } else {
            cacheTTL = 5;
        }

        const feedCacheKey = CACHE_KEYS.MY_CONTESTS(matchId, userId);

        return await cache.cacheAside(
            feedCacheKey,
            async () => {
                const contests = await getMyJoinedContestsWithTeams(matchId, userId);

                // Filter out bonus contests for old versions
                const filteredContests = versionCode === null
                    ? contests.filter(c => !c.bonus_contest)
                    : contests;

                const transformedContests = filteredContests.map(c => transformMyContest(c, userId));

                const result = {
                    system_time: Math.floor(Date.now() / 1000),
                    match_status: match.status_str,
                    match_time: match.timestamp_start,
                    status: true,
                    code: 200,
                    message: 'Success',
                    response: {
                        my_joined_contest: transformedContests
                    },
                    _meta: {
                        processing_time_ms: Date.now() - startTime,
                        version: 'v2'
                    }
                };

                logger.info('My contests generated', {
                    matchId,
                    userId,
                    contestCount: transformedContests.length,
                    duration: Date.now() - startTime
                });

                return result;
            },
            cacheTTL
        );

    } catch (error) {
        logError(error, { context: 'getMyContests', matchId, userId });

        return {
            system_time: Math.floor(Date.now() / 1000),
            status: false,
            code: 500,
            message: 'Failed to fetch my contests',
            _meta: {
                processing_time_ms: Date.now() - startTime,
                error: true
            }
        };
    }
};

module.exports = {
    getContestsByMatch,
    getAllContestsByMatch,
    getMyContests,
};