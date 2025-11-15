/**
 * Prize Breakup Service
 */

const cache = require('../utils/cache');
const { TABLES } = require('../utils/tablesNames');
const { queryAll, queryOne } = require('../config/database');
const { CACHE_KEYS, CACHE_EXPIRY, MATCH_STATUS } = require('../utils/constants');
const { logError, logger } = require('../utils/logger');

/**
 * Get or create prize breakup for flexible/unlimited contests
 */
const getOrCreateFlexiblePrizeBreakup = async (contest) => {
    try {
        if (contest.total_spots !== 0) return null;

        const prizeAmount = contest.filled_spot <= 1
            ? contest.first_prize
            : Math.round(contest.filled_spot * contest.entry_fees * 0.7);

        const existing = await queryOne(`
            SELECT 1 FROM ${TABLES.PRIZE_BREAKUPS}
            WHERE default_contest_id = ?
            AND contest_type_id = ?
            AND match_id = ?
            AND contest_id = ?
            LIMIT 1
        `, [contest.default_contest_id, contest.contest_type, contest.match_id, contest.id]);

        if (existing) return null;

        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await queryOne(`
            INSERT INTO ${TABLES.PRIZE_BREAKUPS}
            (default_contest_id, contest_type_id, rank_from, rank_upto, prize_amount, match_id, contest_id, created_at, updated_at)
            VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)
        `, [
            contest.default_contest_id,
            contest.contest_type,
            prizeAmount,
            contest.match_id,
            contest.id,
            now,
            now
        ]);

        return null;
    } catch (error) {
        logError(error, { context: 'getOrCreateFlexiblePrizeBreakup', contestId: contest.id });
        return null;
    }
};

/**
 * Get prize breakup from database
 */
const getPrizeBreakupData = async (contest) => {
    try {
        // Priority 1: Match + Contest specific
        let breakups = await queryAll(`
            SELECT rank_from, rank_upto, prize_amount, bet_type, min_team, description
            FROM ${TABLES.PRIZE_BREAKUPS}
            WHERE default_contest_id = ?
            AND contest_type_id = ?
            AND match_id = ?
            AND contest_id = ?
            ORDER BY rank_from ASC
        `, [contest.default_contest_id, contest.contest_type, contest.match_id, contest.id]);

        // Priority 2: Default contest type breakup
        if (breakups.length === 0) {
            breakups = await queryAll(`
                SELECT rank_from, rank_upto, prize_amount, bet_type, min_team, description
                FROM ${TABLES.PRIZE_BREAKUPS}
                WHERE default_contest_id = ?
                AND contest_type_id = ?
                ORDER BY rank_from ASC
            `, [contest.default_contest_id, contest.contest_type]);
        }

        // Priority 3: Flexible/Private contest custom breakup
        if ((contest.is_flexible === 1 || contest.is_private === 1) && contest.prize_breakup) {
            try {
                const customBreakup = JSON.parse(contest.prize_breakup);
                if (Array.isArray(customBreakup) && customBreakup.length > 0) {
                    return customBreakup;
                }
            } catch (e) {
                logError(e, { context: 'parsePrizeBreakup', contestId: contest.id });
            }
        }

        return breakups;
    } catch (error) {
        logError(error, { context: 'getPrizeBreakupData', contestId: contest.id });
        return [];
    }
};

/**
 * Format prize breakup for response
 */
const formatPrizeBreakup = (breakups) => {
    if (!breakups || breakups.length === 0) return [];

    return breakups.map(item => {
        const rankRange = (item.rank_from === item.rank_upto || item.rank_upto === 1)
            ? String(item.rank_from)
            : `${item.rank_from}-${item.rank_upto}`;

        return {
            range: rankRange,
            price: item.prize_amount,
            bet_type: item.bet_type || 0,
            min_team: item.min_team || 0,
            additional_prize: item.description || ''
        };
    });
};

/**
 * Get prize breakup for a contest
 */
const getPrizeBreakup = async (matchId, contestId) => {
    const startTime = Date.now();

    try {
        const cacheKey = CACHE_KEYS.PRIZE_BREAKUP(matchId, contestId);
        const match = await queryOne(`
                    SELECT match_id, status FROM ${TABLES.MATCHES}
                    WHERE match_id = ?
                    LIMIT 1
                `, [matchId]);

        if (!match) {
            return {
                system_time: Math.floor(Date.now() / 1000),
                status: false,
                code: 201,
                message: 'match id is invalid'
            };
        }

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const contest = await queryOne(`
                    SELECT 
                        id, match_id, default_contest_id, contest_type,
                        total_spots, filled_spot, entry_fees, first_prize,
                        is_flexible, is_private, prize_breakup
                    FROM ${TABLES.CREATE_CONTESTS}
                    WHERE match_id = ?
                    AND id = ?
                    LIMIT 1
                `, [matchId, contestId]);

                if (!contest) {
                    return {
                        status: false,
                        code: 201,
                        message: 'Contest not found'
                    };
                }

                if (contest.total_spots === 0) {
                    await getOrCreateFlexiblePrizeBreakup(contest);
                }

                const breakups = await getPrizeBreakupData(contest);
                const formattedBreakup = formatPrizeBreakup(breakups);

                logger.info('Prize breakup generated', {
                    matchId,
                    contestId,
                    breakupCount: formattedBreakup.length,
                    duration: Date.now() - startTime
                });

                return {
                    status: true,
                    code: 200,
                    message: 'Prize Breakup',
                    response: {
                        prizeBreakup: formattedBreakup
                    }
                };
            },
            [MATCH_STATUS.COMPLETED, MATCH_STATUS.ABANDONED].includes(match.status) ? CACHE_EXPIRY.ONE_DAY : CACHE_EXPIRY.FIVE_MINUTES
        );
    } catch (error) {
        logError(error, { context: 'getPrizeBreakup', matchId, contestId });

        return {
            status: false,
            code: 500,
            message: 'Failed to fetch prize breakup'
        };
    }
};

module.exports = {
    getPrizeBreakup
};