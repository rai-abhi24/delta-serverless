/**
 * Contest Service - Handles operations related to contests
 */
const crypto = require("crypto");
const config = require('../config');
const cache = require('../utils/cache');
const teamService = require('./team.service');
const { CACHE_KEYS, CACHE_EXPIRY, CRICKET } = require('../utils/constants');
const { queryAll, queryOne, executeTransaction } = require('../config/database');
const { logError, logger } = require('../utils/logger');
const { TABLES } = require('../utils/tablesNames');
const { MATCH_STATUS } = CRICKET;

const trace = () => crypto.randomBytes(6).toString("hex");

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
                    SELECT match_id, status, status_str, format, timestamp_start 
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
        joinedTeams = contest.joined_teams?.length ? contest.joined_teams : [];
    } catch (e) {
        logError(e, { context: 'parseJoinedTeams', contestId: contest.contest_id });
    }

    const isPrivateCreator = contest.is_private === 1 && contest.created_by_user === userId;

    return {
        contestId: contest.contest_id,
        contestTitle: contest.is_private === 1 ? contest.contest_title : contest.contest_type,
        contestSubTitle: contest.contest_subtitle,
        entryFees: contest.entry_fees,
        max_fees: contest.max_fees,
        totalSpots: contest.total_spots,
        filled_spot: filledSpots,
        filledSpots,
        totalWinningPrize,
        firstPrice,
        winnerPercentage: contest.winner_percentage,
        winnerCount: contest.prize_percentage,
        maxAllowedTeam: contest.max_entries,
        maxEntries: contest.max_entries,
        usable_bonus: contest.usable_bonus,
        bonus_contest: contest.bonus_contest === 1,
        is_flexible: contest.is_flexible,
        is_bte: contest.is_bte,
        is_public: 0,
        is_private: contest.is_private,
        is_private_creater: isPrivateCreator ? 1 : 0,
        private_contest_code: contest.coupon_code,
        is_gadget_based: contest.is_gadget_based,
        isCancelled: contest.is_cancelled === 1,
        cancellation: contest.cancellation === "1",
        extra_cash: contest.extra_cash,
        no_of_users_team: joinedTeams.length,
        joinedTeams,
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

/* ------------------ Get Join Contest Status ------------------ */

/**
 * Get join status
 * Combines: contest check, wallet check, user teams, joined teams
 */
const getJoinStatus = async (matchId, contestId, userId) => {
    try {
        const query = `
            SELECT 
                -- Contest data
                cc.id as contest_id,
                cc.match_id,
                cc.entry_fees,
                cc.total_spots,
                cc.filled_spot,
                cc.is_cancelled,
                cc.is_private,
                
                -- Match timing
                m.timestamp_start,
                m.status as match_status,
                
                -- User wallet balance (only deposit + prize)
                (SELECT COALESCE(SUM(amount), 0) 
                 FROM ${TABLES.WALLETS} 
                 WHERE user_id = ? 
                 AND payment_type IN (3, 4)) as wallet_balance,
                
                -- Total teams created
                (SELECT COUNT(*) 
                 FROM ${TABLES.CREATE_TEAMS} 
                 WHERE match_id = ? 
                 AND user_id = ?) as total_teams,
                
                -- Teams already joined in this contest
                (SELECT COUNT(*) 
                 FROM ${TABLES.JOIN_CONTESTS} 
                 WHERE match_id = ? 
                 AND contest_id = ? 
                 AND user_id = ?) as joined_teams,
                
                -- User customer type
                (SELECT customer_type 
                 FROM ${TABLES.USERS} 
                 WHERE id = ? 
                 LIMIT 1) as customer_type
                
            FROM ${TABLES.CREATE_CONTESTS} cc
            INNER JOIN ${TABLES.MATCHES} m ON cc.match_id = m.match_id
            
            WHERE cc.id = ? 
            AND cc.match_id = ?
            LIMIT 1
        `;

        const result = await queryOne(query, [
            userId,           // wallet
            matchId, userId,  // total_teams
            matchId, contestId, userId,  // joined_teams
            userId,           // customer_type
            contestId, matchId
        ]);

        return result;
    } catch (error) {
        logError(error, { context: 'getJoinStatusAtomic', matchId, contestId, userId });
        return null;
    }
};

/**
 * Get available teams (not yet joined in this contest)
 * Returns minimal data (just IDs for client-side filtering)
 */
const getAvailableTeams = async (matchId, contestId, userId) => {
    try {
        const query = `
            SELECT ct.id as team_id
            FROM ${TABLES.CREATE_TEAMS} ct
            WHERE ct.match_id = ?
            AND ct.user_id = ?
            AND ct.id NOT IN (
                SELECT created_team_id 
                FROM ${TABLES.JOIN_CONTESTS}
                WHERE match_id = ?
                AND contest_id = ?
                AND user_id = ?
            )
            ORDER BY ct.id DESC
            LIMIT 50
        `;

        const teams = await queryAll(query, [
            matchId, userId,
            matchId, contestId, userId
        ]);

        return teams.map(t => t.team_id);
    } catch (error) {
        logError(error, { context: 'getAvailableTeams', matchId, contestId, userId });
        return [];
    }
};

/**
 * Validate join eligibility and return action code
 * @returns {Object} { action, message, can_join, available_team_count }
 */
const determineJoinAction = (data) => {
    const currentTime = Math.floor(Date.now() / 1000);

    if (currentTime >= data.timestamp_start) {
        return {
            status: false,
            action: 1,
            message: 'Match time is up',
            can_join: false,
            available_team_count: 0
        };
    }

    if (!data.contest_id || data.is_cancelled === 1) {
        return {
            status: false,
            action: 1,
            message: 'Invalid Contest',
            can_join: false,
            available_team_count: 0
        };
    }

    if (data.customer_type === 9 && data.total_spots < 100) {
        return {
            status: false,
            action: 1,
            message: 'Something went wrong please contact Support for help',
            can_join: false,
            available_team_count: 0
        };
    }

    if (data.total_spots > 0 && data.filled_spot >= data.total_spots) {
        return {
            status: true,
            action: 3,
            message: 'Contest is full',
            can_join: false,
            available_team_count: 0
        };
    }

    if (parseFloat(data.entry_fees) > parseFloat(data.wallet_balance)) {
        return {
            status: false,
            action: 1,
            message: 'Insufficient wallet balance',
            can_join: false,
            available_team_count: 0
        };
    }

    const availableTeams = data.total_teams - data.joined_teams;

    if (data.total_teams === 0) {
        return {
            status: true,
            action: 1,
            message: 'Create new team to join this contest',
            can_join: false,
            available_team_count: 0
        };
    }

    if (availableTeams > 0) {
        return {
            status: true,
            action: 2,
            message: 'Join contest',
            can_join: true,
            available_team_count: availableTeams
        };
    }

    return {
        status: true,
        action: 1,
        message: 'Create new team to join this contest',
        can_join: false,
        available_team_count: 0
    };
};

/**
 * Main function: Join contest status
 */
const getJoinContestStatus = async (matchId, contestId, userId) => {
    const startTime = Date.now();

    try {
        const cacheKey = CACHE_KEYS.JOIN_STATUS(matchId, contestId, userId);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const data = await getJoinStatus(matchId, contestId, userId);

                if (!data) {
                    return {
                        status: false,
                        code: 201,
                        message: 'Invalid Contest or Match',
                        action: 1,
                        team_list: null
                    };
                }

                const result = determineJoinAction(data);

                let teamList = null;
                if (result.available_team_count > 0) {
                    const availableTeamIds = await getAvailableTeams(
                        matchId, contestId, userId
                    );

                    if (availableTeamIds.length > 0) {
                        const teeamData = await teamService.getMyTeams(matchId, userId, { type: 'open', open_team_id: availableTeamIds });
                        teamList = [{ open_team: teeamData.response.myteam }];
                    }
                }

                const response = {
                    status: result.status,
                    code: 200,
                    message: result.message,
                    action: result.action,
                    team_list: teamList,
                    available_teams: result.available_team_count,
                    _meta: {
                        processing_time_ms: Date.now() - startTime
                    }
                };

                logger.info('Join status checked', {
                    matchId,
                    contestId,
                    userId,
                    action: result.action,
                    duration: Date.now() - startTime
                });

                return response;
            },
            CACHE_EXPIRY.THIRTY_SECONDS
        );

    } catch (error) {
        logError(error, { context: 'getJoinContestStatus', matchId, contestId, userId });

        return {
            status: false,
            code: 500,
            message: 'Failed to check join status',
            action: 1,
            team_list: null,
            _meta: {
                processing_time_ms: Date.now() - startTime,
                error: true
            }
        };
    }
};

/* ------------------------ Join Contest ------------------------ */

/**
 * PRE-FLIGHT VALIDATION (parallel queries)
 */
const validateJoinRequest = async (userId, matchId, contestId, teamIds) => {
    try {
        const [user, match, contest] = await Promise.all([
            queryOne(`SELECT id, name, team_name, customer_type FROM ${TABLES.USERS} WHERE id = ?`, [userId]),
            queryOne(`SELECT match_id, timestamp_start, status FROM ${TABLES.MATCHES} WHERE match_id = ?`, [matchId]),
            queryOne(`
                SELECT cc.id, cc.entry_fees, cc.total_spots, cc.filled_spot, cc.usable_bonus,
                    cc.extra_cash, cc.bonus_contest, cc.is_bte, ct.max_entries, cc.contest_type
                FROM ${TABLES.CREATE_CONTESTS} cc
                LEFT JOIN ${TABLES.CONTEST_TYPES} ct ON cc.contest_type = ct.id
                WHERE cc.id = ?
            `, [contestId])
        ]);

        if (!user) return { valid: false, error: { status: false, code: 201, message: 'Invalid user' } };
        if (!match) return { valid: false, error: { status: false, code: 201, message: 'Invalid match' } };
        if (!contest) return { valid: false, error: { status: false, code: 201, message: 'Invalid contest' } };

        const nowSec = Math.floor(Date.now() / 1000);
        if (nowSec > Number(match.timestamp_start)) {
            return { valid: false, error: { status: false, code: 201, message: 'Match time up' } };
        }

        const placeholders = teamIds.map(_ => '?').join(',');
        const teamsQuery = `SELECT id, match_id, team_count FROM ${TABLES.CREATE_TEAMS} WHERE id IN (${placeholders}) AND user_id = ?`;
        console.log(teamsQuery, teamIds);

        const teamsParams = [...teamIds, userId];
        const teams = await queryAll(teamsQuery, teamsParams);

        if (!teams || teams.length !== teamIds.length) {
            return { valid: false, error: { status: false, code: 201, message: 'Invalid team IDs or teams not owned by user' } };
        }

        const badTeam = teams.find(t => Number(t.match_id) !== Number(matchId));
        if (badTeam) {
            return { valid: false, error: { status: false, code: 201, message: 'One or more teams not valid for this match' } };
        }

        const existingJoinsRow = await queryOne(`SELECT COUNT(1) AS count FROM ${TABLES.JOIN_CONTESTS} WHERE contest_id = ? AND user_id = ?`, [contestId, userId]);

        if (contest.total_spots > 0 && contest.filled_spot >= contest.total_spots) {
            return { valid: false, error: { status: false, code: 201, message: 'Contest is already full' } };
        }

        // wallet summary for pre-check - but note: this is only indicative; actual deductions validated inside txn
        // Sum wallet rows by payment_type
        const walletSummary = await queryAll(`
            SELECT payment_type, SUM(amount) AS amount_sum
            FROM ${TABLES.WALLETS}
            WHERE user_id = ? AND payment_type IN (3, 4)
        `, [userId]);

        const walletMap = {};
        walletSummary.forEach(r => walletMap[r.payment_type] = Number(r.amount_sum || 0));

        return {
            valid: true,
            data: {
                user,
                match,
                contest,
                teams,
                walletMap,
                existingJoinCount: existingJoinsRow?.count || 0
            }
        };
    } catch (error) {
        logError(error, { context: 'validateJoinRequest' });
        return { valid: false, error: { status: false, code: 500, message: 'Validation failed' } };
    }
};

/**
 * Calculate cost for ONE team
 */
const calculatePerTeamCost = (entryFee, usableBonusPercent, extraCashPercent, isBonusContest) => {
    if (!entryFee || Number(entryFee) === 0) {
        return { totalCost: 0, bonus: 0, extraCash: 0, cash: 0 };
    }

    const totalCost = Number(entryFee);

    if (isBonusContest) {
        return { totalCost, bonus: totalCost, extraCash: 0, cash: 0 };
    }

    const bonus = Number((totalCost * (usableBonusPercent || 0) / 100).toFixed(2));
    let remaining = Number((totalCost - bonus).toFixed(2));

    const extraCash = Number((remaining * (extraCashPercent || 0) / 100).toFixed(2));
    remaining = Number((remaining - extraCash).toFixed(2));

    return { totalCost, bonus, extraCash, cash: remaining };
};

/**
 * DEDUCT FROM WALLETS (atomic, within transaction)
 */
const deductForSingleTeam = async (connection, walletRows, cost) => {
    // Build map and in-memory amounts
    const walletMap = {};
    walletRows.forEach(r => walletMap[r.payment_type] = { id: r.id, amount: Number(r.amount || 0) });

    // Track deductions
    let rem = Number(cost.totalCost || 0);
    const ded = { bonus: 0, extraCash: 0, deposit: 0, prize: 0 };

    // Bonus first (type 1)
    if (cost.bonus > 0 && walletMap[1]?.amount > 0) {
        const take = Math.min(cost.bonus, walletMap[1].amount, rem);
        if (take > 0) {
            await connection.execute(`
                INSERT INTO ${TABLES.WALLET_TRANSACTIONS}
                (user_id, amount, payment_type, payment_type_string, transaction_id, debit_credit_status, payment_status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [walletRows[0]?.user_id, take, 1, 'EntryFee-Bonus', null, '-', 'success']); // transaction_id null here - you can populate
            await connection.execute(`UPDATE ${TABLES.WALLETS} SET amount = amount - ? WHERE id = ?`, [take, walletMap[1].id]);
            walletMap[1].amount -= take;
            rem = Number((rem - take).toFixed(2));
            ded.bonus += take;
        }
    }

    // Extra cash (type 9)
    if (cost.extraCash > 0 && walletMap[9]?.amount > 0 && rem > 0) {
        const take = Math.min(cost.extraCash, walletMap[9].amount, rem);
        if (take > 0) {
            await connection.execute(`
                INSERT INTO ${TABLES.WALLET_TRANSACTIONS}
                (user_id, amount, payment_type, payment_type_string, transaction_id, debit_credit_status, payment_status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [walletRows[0]?.user_id || null, take, 9, 'EntryFee-ExtraCash', null, '-', 'success']);
            await connection.execute(`UPDATE ${TABLES.WALLETS} SET amount = amount - ? WHERE id = ?`, [take, walletMap[9].id]);
            walletMap[9].amount -= take;
            rem = Number((rem - take).toFixed(2));
            ded.extraCash += take;
        }
    }

    // Deposit (type 3)
    if (rem > 0 && walletMap[3]?.amount > 0) {
        const take = Math.min(rem, walletMap[3].amount);
        if (take > 0) {
            await connection.execute(`
                INSERT INTO ${TABLES.WALLET_TRANSACTIONS}
                (user_id, amount, payment_type, payment_type_string, transaction_id, debit_credit_status, payment_status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [walletRows[0]?.user_id || null, take, 3, 'EntryFee-Deposit', null, '-', 'success']);
            await connection.execute(`UPDATE ${TABLES.WALLETS} SET amount = amount - ? WHERE id = ?`, [take, walletMap[3].id]);
            walletMap[3].amount -= take;
            rem = Number((rem - take).toFixed(2));
            ded.deposit += take;
        }
    }

    // Prize (type 4) last
    if (rem > 0 && walletMap[4]?.amount > 0) {
        const take = Math.min(rem, walletMap[4].amount);
        if (take > 0) {
            await connection.execute(`
                INSERT INTO ${TABLES.WALLET_TRANSACTIONS}
                (user_id, amount, payment_type, payment_type_string, transaction_id, debit_credit_status, payment_status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [walletRows[0]?.user_id || null, take, 4, 'EntryFee-Prize', null, '-', 'success']);
            await connection.execute(`UPDATE ${TABLES.WALLETS} SET amount = amount - ? WHERE id = ?`, [take, walletMap[4].id]);
            walletMap[4].amount -= take;
            rem = Number((rem - take).toFixed(2));
            ded.prize += take;
        }
    }

    if (rem > 0.001) {
        throw new Error('INSUFFICIENT_BALANCE_IN_TXN');
    }

    walletRows.forEach(w => {
        if (walletMap[w.payment_type]) w.amount = walletMap[w.payment_type].amount;
    });

    return ded;
};

/**
 * Insert JOIN record (single)
 */
const insertJoinRecord = async (connection, payload) => {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    await connection.execute(`
        INSERT INTO ${TABLES.JOIN_CONTESTS}
        (user_id, match_id, contest_id, created_team_id, team_count, user_name, team_name,
        entry_fees, entryfee_bonus, entryfee_deposit, entryfee_winning, entryfee_extracash,
        customer_type, is_bte, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        payload.userId,
        payload.matchId,
        payload.contestId,
        payload.teamId,
        payload.team_count,
        payload.user_name,
        payload.team_name,
        payload.entry_fee,
        payload.entryfee_bonus,
        payload.entryfee_deposit,
        payload.entryfee_winning,
        payload.entryfee_extracash,
        payload.customer_type,
        payload.is_bte ? 1 : 0,
        now,
        now
    ]);
};

/**
 * INVALIDATE CACHE (async, non-blocking)
 */
const doInvalidateCache = async (userId, matchId) => {
    try {
        await Promise.all([
            cache.del(CACHE_KEYS.USER_CONTESTS(matchId, userId)),
            cache.del(CACHE_KEYS.MY_CONTESTS(matchId, userId)),
            cache.del(CACHE_KEYS.CONTEST_FEED(matchId, 1)),
            cache.del(CACHE_KEYS.CONTEST_CATALOG(matchId)),
        ]);
    } catch (err) {
        logError(err, { context: 'doInvalidateCache' });
    }
};

const simulateSingleTeam = (rows, costObj) => {
    // helper local similar to deductForSingleTeam but only simulate on rows
    const map = {};
    rows.forEach(r => map[r.payment_type] = r);
    let rem = Number(costObj.totalCost || 0);
    // bonus
    if (costObj.bonus > 0 && map[1]?.amount > 0) {
        const t = Math.min(costObj.bonus, map[1].amount, rem);
        map[1].amount = Number((map[1].amount - t).toFixed(2)); rem -= t;
    }
    // extra 9
    if (costObj.extraCash > 0 && map[9]?.amount > 0 && rem > 0) {
        const t = Math.min(costObj.extraCash, map[9].amount, rem);
        map[9].amount = Number((map[9].amount - t).toFixed(2)); rem -= t;
    }
    // deposit 3
    if (rem > 0 && map[3]?.amount > 0) {
        const t = Math.min(rem, map[3].amount);
        map[3].amount = Number((map[3].amount - t).toFixed(2)); rem -= t;
    }
    // prize 4
    if (rem > 0 && map[4]?.amount > 0) {
        const t = Math.min(rem, map[4].amount);
        map[4].amount = Number((map[4].amount - t).toFixed(2)); rem -= t;
    }
    return rem <= 0.001;
}

/**
 * Join contest
 * Uses database-level locking and atomic operations
 */
const joinContest = async (userId, matchId, contestId, teamIds) => {
    const traceId = trace();
    const startTime = Date.now();

    logger.info({ traceId, step: "INIT", userId, matchId, contestId, teamIds }, "joinContest start");

    // 1. Validation
    const validation = await validateJoinRequest(userId, matchId, contestId, teamIds);
    logger.info({ traceId, step: "VALIDATION_RESULT", validation }, "Validation completed");

    if (!validation.valid) {
        logger.warn({ traceId, step: "VALIDATION_FAILED", validation }, "Join request validation failed");
        return validation.error;
    }

    const { user, contest, teams } = validation.data;

    // Calculate cost per team
    const perTeamCost = calculatePerTeamCost(
        contest.entry_fees,
        contest.usable_bonus,
        contest.extra_cash,
        contest.bonus_contest
    );
    logger.info({ traceId, step: "COST_CALCULATED", perTeamCost }, "Per team cost calculated");

    try {
        const result = await executeTransaction(async (connection) => {
            logger.info({ traceId, step: "LOCK_CONTEST", contestId }, "Locking contest row");

            const [lockedContestRows] = await connection.execute(`
                SELECT id, total_spots, filled_spot
                FROM ${TABLES.CREATE_CONTESTS}
                WHERE id = ? FOR UPDATE
            `, [contestId]);

            const lockedContest = lockedContestRows[0];
            logger.info({ traceId, step: "CONTEST_LOCKED", lockedContest }, "Contest row locked");

            if (!lockedContest) throw new Error("CONTEST_NOT_FOUND");

            // spot checks
            const spotsNeeded = teamIds.length;
            const spotsAvailable = lockedContest.total_spots === 0
                ? Number.MAX_SAFE_INTEGER
                : (lockedContest.total_spots - lockedContest.filled_spot || 0);

            logger.info({ traceId, step: "SPOT_CHECK", spotsNeeded, spotsAvailable }, "Checking available spots");

            if (spotsAvailable <= 0) throw new Error("CONTEST_FULL");
            if (spotsNeeded > spotsAvailable) throw new Error("INSUFFICIENT_SPOTS");


            // --- LOCK USER WALLET ---
            logger.info({ traceId, step: "LOCK_WALLET", userId }, "Locking user wallet rows");

            const [walletRowsRes] = await connection.execute(`
                SELECT id, user_id, payment_type, amount
                FROM ${TABLES.WALLETS}
                WHERE user_id = ? FOR UPDATE
            `, [userId]);

            const walletRows = walletRowsRes.map(r => ({
                id: r.id,
                user_id: r.user_id,
                payment_type: r.payment_type,
                amount: Number(r.amount || 0)
            }));

            logger.info({ traceId, step: "WALLET_LOCKED", walletRows }, "Wallet rows locked");


            // --- SIMULATE FUNDS ---
            logger.info({ traceId, step: "SIMULATING_FUNDS", walletRows, perTeamCost }, "Simulating wallet deductions");

            let walletRowsClone = JSON.parse(JSON.stringify(walletRows));
            for (let i = 0; i < teamIds.length; i++) {
                const ok = simulateSingleTeam(walletRowsClone, perTeamCost);
                logger.info({ traceId, step: "SIMULATION_RESULT", teamIndex: i, ok, walletRowsClone }, "Simulation result");

                if (!ok) throw new Error("INSUFFICIENT_BALANCE");
            }


            // --- PROCESS TEAMS ---
            const joined = [];

            for (const teamId of teamIds) {
                logger.info({ traceId, step: "CHECK_DUPLICATE", teamId }, "Checking if team already joined");

                const [existsRows] = await connection.execute(`
                    SELECT 1 FROM ${TABLES.JOIN_CONTESTS}
                    WHERE contest_id = ? AND created_team_id = ? LIMIT 1
                `, [contestId, teamId]);

                if (existsRows[0]) {
                    logger.warn({ traceId, step: "DUPLICATE_FOUND", teamId }, "Team already joined this contest");
                    throw new Error("TEAM_ALREADY_JOINED");
                }

                const teamObj = teams.find(t => Number(t.id) === Number(teamId));
                const team_count = teamObj?.team_count || "T1";

                logger.info({ traceId, step: "DEDUCTING_FUNDS", teamId, perTeamCost }, "Deducting wallet funds");

                const deductions = await deductForSingleTeam(connection, walletRows, perTeamCost);

                logger.info({ traceId, step: "DEDUCTIONS_DONE", teamId, deductions }, "Wallet deduction completed");


                // insert
                logger.info({ traceId, step: "INSERT_JOIN", teamId }, "Inserting join record");

                await insertJoinRecord(connection, {
                    userId,
                    matchId,
                    contestId,
                    teamId,
                    team_count,
                    user_name: user.name,
                    team_name: user.team_name,
                    entry_fee: perTeamCost.totalCost,
                    entryfee_bonus: deductions.bonus,
                    entryfee_deposit: deductions.deposit,
                    entryfee_winning: deductions.prize,
                    entryfee_extracash: deductions.extraCash,
                    customer_type: user.customer_type || 0,
                    is_bte: contest.is_bte || 0
                });

                logger.info({ traceId, step: "JOIN_INSERTED", teamId }, "Team join record inserted");

                // update team join status
                await connection.execute(
                    `UPDATE ${TABLES.CREATE_TEAMS} SET team_join_status = 1 WHERE id = ?`,
                    [teamId]
                );

                logger.info({ traceId, step: "TEAM_STATUS_UPDATED", teamId }, "Team join status updated");

                joined.push(teamId);
            }

            // update contest filled_spot
            if (joined.length > 0) {
                logger.info({ traceId, step: "UPDATE_FILLED_SPOT", increment: joined.length }, "Updating filled_spot");

                await connection.execute(`
                    UPDATE ${TABLES.CREATE_CONTESTS}
                    SET filled_spot = filled_spot + ?
                    WHERE id = ?
                `, [joined.length, contestId]);
            }

            logger.info({ traceId, step: "TXN_COMPLETE", joined }, "Transaction complete");

            return { joinedTeams: joined, perTeamCost };
        });

        // post cache invalidation
        setImmediate(() => {
            logger.info({ traceId, step: "CACHE_INVALIDATE_START" }, "Invalidating cache...");
            doInvalidateCache(userId, matchId).catch(err =>
                logError(err, { traceId, context: "postJoinInvalidate" })
            );
        });

        logger.info({
            traceId,
            step: "SUCCESS",
            userId,
            matchId,
            contestId,
            teamsJoined: result.joinedTeams.length,
            durationMs: Date.now() - startTime
        }, "joinContest success");

        return {
            status: true,
            code: 200,
            message: "Team(s) joined successfully",
            teams_joined: result.joinedTeams.length,
            cost_for_each_team: result.perTeamCost
        };

    } catch (error) {
        logger.error({ traceId, step: "ERROR_CAUGHT", error }, "joinContest error");

        if (error.message === "CONTEST_FULL") {
            return { status: false, code: 201, message: "This contest is already full" };
        }
        if (error.message === "INSUFFICIENT_SPOTS") {
            return { status: false, code: 201, message: "Not enough spots available" };
        }
        if (error.message === "INSUFFICIENT_BALANCE" || error.message === "INSUFFICIENT_BALANCE_IN_TXN") {
            return { status: false, code: 201, message: "Insufficient balance" };
        }
        if (error.message === "TEAM_ALREADY_JOINED") {
            return { status: false, code: 201, message: "This team has already joined this contest" };
        }

        throw error;
    }
};

module.exports = {
    getContestsByMatch,
    getAllContestsByMatch,
    getMyContests,
    getJoinContestStatus,
    joinContest,
};