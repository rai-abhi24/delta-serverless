/**
 * Contest Service - Handles operations related to contests
 */

const config = require('../config');
const cache = require('../utils/cache');
const { CACHE_KEYS, CACHE_EXPIRY } = require('../utils/constants');
const { queryAll, queryOne } = require('../config/database');
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
    // Calculate filled spots (add fake counter for large contests)
    let filledSpots = contest.filled_spot;
    if (contest.total_spots > 500 || contest.is_bte === 1) {
        filledSpots += (contest.fake_counter || 0);
    }

    // Calculate dynamic prize for flexible contests
    let totalWinningPrize = contest.total_winning_prize;
    let firstPrize = contest.first_prize;

    if (contest.total_spots === 0) {
        const revenue = contest.filled_spot * contest.entry_fees * 0.7;
        totalWinningPrize = Math.round(revenue);
        firstPrize = Math.round(revenue);

        if (totalWinningPrize < contest.entry_fees) {
            firstPrize = contest.entry_fees;
            if (contest.filled_spot > 1) {
                totalWinningPrize = contest.entry_fees * (contest.filled_spot - 1);
            } else {
                totalWinningPrize = contest.entry_fees;
            }
        }
    }

    const userJoined = userJoinedData[contest.contest_id] || { count: 0 };
    const isUserExpert = contest.is_bte === 1 && contest.expert_id === userId;

    return {
        contestId: contest.contest_id,
        contest_type_id: contest.contest_type,

        // Contest details
        entryFees: contest.entry_fees,
        max_fees: contest.max_fees,
        totalSpots: contest.total_spots,
        filled_spot: filledSpots,
        totalWinningPrize,
        firstPrice: firstPrize,

        // Contest properties
        winnerPercentage: contest.winner_percentage,
        winnerCount: contest.winner_count || contest.prize_percentage,
        maxAllowedTeam: contest.max_entries,
        usable_bonus: contest.usable_bonus,

        // Flags
        bonus_contest: contest.bonus_contest === 1,
        is_flexible: contest.is_flexible === 1,
        isCancelled: contest.is_cancelled === 1,
        cancellation: contest.cancellation === 1,

        // Additional fields
        sort_by: contest.sort_by,
        extra_cash: contest.extra_cash,

        // User-specific data
        no_of_users_team: isUserExpert ? 1 : userJoined.count,

        // Expert data (for BTE contests)
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

/**
 * Auto-create contests when they fill up
 * Runs asynchronously without blocking the response
 */
// const autoCreateContests = async (matchId) => {
//     try {
//         const filledContests = await queryAll(`
//             SELECT id, default_contest_id FROM ${TABLES.CREATE_CONTESTS}
//             WHERE match_id = ?
//             AND filled_spot = total_spots
//             AND cancellation = 1
//             AND is_cloned = 0
//             AND is_private = 0
//             AND total_spots > 0
//         `, [matchId]);

//         if (filledContests.length === 0) {
//             return;
//         }

//         for (const contest of filledContests) {
//             const existingCount = await queryOne(`
//                 SELECT COUNT(*) as count
//                 FROM ${TABLES.CREATE_CONTESTS}
//                 WHERE match_id = ?
//                 AND default_contest_id = ?
//                 AND filled_spot < total_spots
//             `, [matchId, contest.default_contest_id]);

//             if (existingCount.count === 0) {
//                 await queryOne(`
//                     UPDATE ${TABLES.CREATE_CONTESTS} 
//                     SET is_cloned = 1 
//                     WHERE id = ?`,
//                     [contest.id]
//                 );

//                 await queryOne(`
//                     INSERT INTO ${TABLES.CREATE_CONTESTS} (
//                         contest_type, 
//                         entry_fees, 
//                         mrp as max_fees, 
//                         total_spots, 
//                         filled_spot, 
//                         fake_counter, 
//                         total_winning_prize, 
//                         first_prize, 
//                         winner_percentage,
//                         prize_percentage, 
//                         usable_bonus, 
//                         bonus_contest, 
//                         is_flexible, 
//                         is_bte, 
//                         is_cancelled, 
//                         cancellation, 
//                         sort_by, 
//                         extra_cash, 
//                         expert_id,
//                         is_cloned
//                     ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
//                 `, [
//                     contest.contest_type,
//                     contest.entry_fees,
//                     contest.max_fees,
//                     contest.match_id,
//                     contest.total_spots,
//                     contest.filled_spot,
//                     contest.fake_counter,
//                     contest.total_winning_prize,
//                     contest.first_prize,
//                     contest.winner_percentage,
//                     contest.prize_percentage,
//                     contest.usable_bonus,
//                     contest.bonus_contest,
//                     contest.is_flexible,
//                     contest.is_bte,
//                     contest.is_cancelled,
//                     contest.cancellation,
//                     contest.sort_by,
//                     contest.extra_cash,
//                     contest.expert_id
//                 ]);
//                 logger.info('Auto-created contest', {
//                     matchId,
//                     originalContestId: contest.id
//                 });
//             }
//         }

//         // Clear contest cache after auto-creation
//         await cache.del(CACHE_KEYS.CONTEST_CATALOG(matchId));

//     } catch (error) {
//         logError(error, { context: 'autoCreateContests', matchId });
//     }
// };

module.exports = {
    getContestsByMatch
};