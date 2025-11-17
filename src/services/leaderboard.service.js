const { executeTransaction, queryAll, queryOne } = require("../config/database");
const cache = require("../utils/cache");
const { CACHE_KEYS, CACHE_EXPIRY, MATCH_STATUS } = require("../utils/constants");
const { logger, logError } = require("../utils/logger");
const { TABLES } = require("../utils/tablesNames");

/**
 * Validate match and contest
 */
const validateMatchAndContest = async (matchId, contestId) => {
    try {
        const [match, contest] = await Promise.all([
            cache.cacheAside(
                CACHE_KEYS.MATCH_META(matchId),
                async () => {
                    return await queryOne(`
                        SELECT match_id, timestamp_start, status, status_str 
                        FROM ${TABLES.MATCHES} 
                        WHERE match_id = ? 
                        LIMIT 1`,
                        [matchId]
                    );
                },
                CACHE_EXPIRY.ONE_DAY
            ),
            cache.cacheAside(
                CACHE_KEYS.CONTEST_META(contestId),
                async () => {
                    return await queryOne(`
                        SELECT id, total_spots, filled_spot, is_pdf_generated
                        FROM ${TABLES.CREATE_CONTESTS}
                        WHERE id = ? 
                        LIMIT 1`,
                        [contestId]
                    );
                },
                CACHE_EXPIRY.ONE_MINUTE
            )
        ]);

        return { match, contest };
    } catch (error) {
        logError(error, { context: "validateMatchAndContest", matchId, contestId });
        return { match: null, contest: null };
    }
};

/**
 * Check for double entries and clean up
 */
const checkDoubleEntry = async (match, contest) => {
    if (match.status !== MATCH_STATUS.UPCOMING && match.status !== MATCH_STATUS.COMPLETED && match.status !== MATCH_STATUS.ABANDONED) {
        return;
    }

    if (contest.total_spots <= 300 && contest.flexible_confirm === 0) {
        setImmediate(async () => {
            try {
                await getContestDetails(match, contest);
                await checkMoreThanTotalSpotsEntry(match, contest);
            } catch (err) {
                logError(err, { context: 'checkDoubleEntry', matchId: match.match_id, contestId: contest.id });
            }
        });
    }
};

/**
 * Find and remove duplicate entries
 */
const getContestDetails = async (match, contest) => {
    const matchId = match.match_id;
    const contestId = contest.id;

    try {
        const duplicates = await queryAll(`
            SELECT contest_id, user_id, team_count, COUNT(*) as count
            FROM ${TABLES.JOIN_CONTESTS}
            WHERE match_id = ? 
            AND contest_id = ?
            AND customer_type IN (0, 7)
            GROUP BY contest_id, user_id, team_count
            HAVING count > 1`,
            [matchId, contestId]
        );

        for (const duplicate of duplicates) {
            await executeTransaction(async (connection) => {
                const records = await connection.execute(`
                    SELECT * FROM ${TABLES.JOIN_CONTESTS}
                    WHERE match_id = ? 
                    AND contest_id = ? 
                    AND user_id = ? 
                    AND team_count = ?
                    ORDER BY id ASC`,
                    [matchId, duplicate.contest_id, duplicate.user_id, duplicate.team_count]
                );

                if (records[0].length > 1) {
                    const recordsToRemove = records[0].slice(1);

                    for (const record of recordsToRemove) {
                        await refundMoney(connection, record);
                        await connection.execute(
                            `DELETE FROM ${TABLES.JOIN_CONTESTS} WHERE id = ?`,
                            [record.id]
                        );
                    }

                    await checkCurrentStatus(connection, contestId);
                }
            });
        }
    } catch (error) {
        logError(error, { context: 'getContestDetails', matchId, contestId });
        throw error;
    }
};

/**
 * Check if contest has more entries than total spots
 */
const checkMoreThanTotalSpotsEntry = async (match, contest) => {
    const matchId = match.match_id;
    const contestId = contest.id;
    const totalSpots = contest.total_spots;

    try {
        const filledSpotsCount = await queryOne(`
            SELECT COUNT(*) as count 
            FROM ${TABLES.JOIN_CONTESTS}
            WHERE match_id = ? 
            AND contest_id = ?`,
            [matchId, contestId]
        );

        if (filledSpotsCount.count > totalSpots) {
            await removeMoreThanTotalSpotsEntry(matchId, contestId, totalSpots);
        }
    } catch (error) {
        logError(error, { context: 'checkMoreThanTotalSpotsEntry', matchId, contestId });
    }
};

/**
 * Remove excess entries beyond total spots
 */
const removeMoreThanTotalSpotsEntry = async (matchId, contestId, totalSpots) => {
    try {
        await executeTransaction(async (connection) => {
            const excessEntries = await connection.execute(`
                SELECT * FROM ${TABLES.JOIN_CONTESTS}
                WHERE match_id = ? 
                AND contest_id = ?
                ORDER BY id DESC 
                LIMIT 100000 OFFSET ?`,
                [matchId, contestId, totalSpots]
            );

            for (const entry of excessEntries[0]) {
                await refundMoney(connection, entry);
                await connection.execute(
                    `DELETE FROM ${TABLES.JOIN_CONTESTS} WHERE id = ?`,
                    [entry.id]
                );
            }

            await checkCurrentStatus(connection, contestId);
        });
    } catch (error) {
        logError(error, { context: 'removeMoreThanTotalSpotsEntry', matchId, contestId });
    }
};

/**
 * Refund money for removed entries
 */
const refundMoney = async (connection, joinContestRecord) => {
    try {
        // Implement refund logic here
        // This would typically involve wallet transactions
        logger.info('Refunding money for join contest record', {
            joinContestId: joinContestRecord.id,
            userId: joinContestRecord.user_id,
            amount: joinContestRecord.entry_fees
        });

        // Example refund implementation:
        // await connection.execute(`
        //     INSERT INTO ${TABLES.WALLET_TRANSACTIONS} 
        //     (user_id, match_id, contest_id, amount, type, created_at) 
        //     VALUES (?, ?, ?, ?, 'refund', NOW())`,
        //     [joinContestRecord.user_id, joinContestRecord.match_id, 
        //      joinContestRecord.contest_id, joinContestRecord.entry_fees]
        // );
    } catch (error) {
        logError(error, { context: 'refundMoney', joinContestId: joinContestRecord.id });
        throw error;
    }
};

/**
 * Update contest status after cleanup
 */
const checkCurrentStatus = async (connection, contestId) => {
    try {
        const currentFilled = await connection.execute(`
            SELECT COUNT(*) as filled_spot 
            FROM ${TABLES.JOIN_CONTESTS} 
            WHERE contest_id = ?`,
            [contestId]
        );

        await connection.execute(`
            UPDATE ${TABLES.CREATE_CONTESTS} 
            SET filled_spot = ? 
            WHERE id = ?`,
            [currentFilled[0][0]?.filled_spot || 0, contestId]
        );
    } catch (error) {
        logError(error, { context: 'checkCurrentStatus', contestId });
        throw error;
    }
};

/**
 * Get user's teams for the contest (rank 1)
 */
const getUserLeaderboardTeams = async (matchId, contestId, userId) => {
    try {
        const query = `
            SELECT 
                jc.match_id,
                jc.created_team_id AS team_id,
                jc.user_id,
                jc.team_count AS team,
                jc.points AS point,
                jc.ranks AS 'rank',
                jc.winning_amount,
                jc.team_name,
                jc.user_name,
                u.name AS user_full_name,
                u.first_name,
                u.last_name,
                u.profile_image,
                u.customer_type AS short_name
            FROM ${TABLES.JOIN_CONTESTS} jc
            LEFT JOIN ${TABLES.USERS} u ON jc.user_id = u.id
            WHERE jc.match_id = ? AND jc.contest_id = ? AND jc.user_id = ?
            ORDER BY jc.ranks ASC
        `;

        const teams = await queryAll(query, [matchId, contestId, userId]);
        return teams.map(t => transform(t));
    } catch (error) {
        logError(error, { context: "getUserLeaderboardTeams", matchId, contestId, userId });
        return [];
    }
};

/**
 * Get paginated leaderboard (rank 2+)
 */
const getPaginatedLeaderboard = async (matchId, contestId, userId, page, perPage) => {
    try {
        const offset = (page - 1) * perPage;

        const query = `
            SELECT 
                jc.match_id,
                jc.created_team_id AS team_id,
                jc.user_id,
                jc.team_count AS team,
                jc.points AS point,
                jc.ranks AS rank,
                jc.winning_amount,
                jc.team_name,
                jc.user_name,
                u.name AS user_full_name,
                u.first_name,
                u.last_name,
                u.profile_image,
                u.customer_type AS short_name
            FROM ${TABLES.JOIN_CONTESTS} jc
            INNER JOIN ${TABLES.USERS} u ON jc.user_id = u.id
            WHERE jc.match_id = ? 
            AND jc.contest_id = ?
            AND jc.user_id != ?
            ORDER BY jc.ranks ASC
            LIMIT ? OFFSET ?
        `;

        const teams = await queryAll(query, [
            matchId, contestId, userId, perPage, offset
        ]);

        return teams.map(t => transform(t));
    } catch (error) {
        logError(error, { context: "getPaginatedLeaderboard", matchId, contestId, userId });
        return [];
    }
};

/**
 * Get total count for pagination
 */
const getLeaderboardCount = async (matchId, contestId, excludeUser) => {
    try {
        const result = await queryOne(
            `SELECT COUNT(*) AS total 
             FROM ${TABLES.JOIN_CONTESTS}
             WHERE match_id = ? AND contest_id = ? AND user_id != ?`,
            [matchId, contestId, excludeUser]
        );

        return result?.total || 0;
    } catch (error) {
        logError(error, { context: "getLeaderboardCount" });
        return 0;
    }
};

/**
 * Transform leaderboard entry
 */
const transform = (entry) => {
    const parts = entry.user_full_name ? entry.user_full_name.split(" ") : ["", ""];
    return {
        match_id: entry.match_id,
        team_id: entry.team_id,
        user_id: entry.user_name || entry.user_id,
        team: entry.team,
        point: entry.point,
        rank: entry.rank,
        prize_amount: entry.winning_amount || 0,
        user: {
            first_name: entry.first_name || parts[0],
            last_name: entry.last_name || parts[1],
            name: entry.user_name || entry.team_name || parts[0],
            team_name: entry.team_name,
            profile_image: entry.profile_image,
            short_name: entry.short_name
        }
    };
};

/**
 * Main function: Get leaderboard
 */
const getLeaderboard = async (matchId, contestId, userId, page = 1) => {
    const start = Date.now();
    const perPage = 20;

    try {
        const cacheKey = CACHE_KEYS.LEADERBOARD(matchId, contestId, page);
        const cached = await cache.get(cacheKey);

        if (cached) {
            cached._meta = { cache_status: "hit", time: Date.now() - start };
            return cached;
        }

        const { match, contest } = await validateMatchAndContest(matchId, contestId);

        if (!contest) {
            return {
                status: false,
                code: 201,
                message: "Invalid Contest",
                system_time: Math.floor(Date.now() / 1000)
            };
        }

        // ---- FETCH LEADERBOARD ----
        const [userTeams, otherTeams, totalCount] = await Promise.all([
            page === 1 ? getUserLeaderboardTeams(matchId, contestId, userId) : Promise.resolve([]),
            getPaginatedLeaderboard(matchId, contestId, userId, page, perPage),
            getLeaderboardCount(matchId, contestId, userId)
        ]);

        const leaderboard = [...userTeams, ...otherTeams];
        const totalPages = Math.ceil(totalCount / perPage);

        const response = {
            system_time: Math.floor(Date.now() / 1000),
            match_status: match?.status_str,
            match_time: match?.timestamp_start,
            total_team_count: contest.filled_spot,
            is_pdf_generated: contest.is_pdf_generated,
            status: true,
            code: 200,
            leaderBoard: leaderboard,
            pagination: {
                current_page: page,
                total_pages: totalPages
            },
            _meta: {
                processing_time_ms: Date.now() - start,
                cache_status: "miss"
            }
        };

        await cache.set(cacheKey, response, CACHE_EXPIRY.TWO_MINUTES);

        return response;

    } catch (error) {
        logError(error, { context: "getLeaderboard" });

        return {
            status: false,
            code: 500,
            message: "Failed to fetch leaderboard",
            system_time: Math.floor(Date.now() / 1000),
            _meta: { error: true }
        };
    }
};

module.exports = {
    getLeaderboard
};