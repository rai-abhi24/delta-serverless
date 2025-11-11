/**
 * Banner service for promotions and ads
 */

const { queryAll } = require('../config/database');
const cache = require('../utils/cache');
const { CACHE_KEYS, BANNER_TYPES } = require('../utils/constants');
const config = require('../config');
const { logError, logger } = require('../utils/logger');
const { getFantasyKey } = require('../utils/helper');
const { TABLES } = require('../utils/tablesNames');

/**
 * Get promotion banners with caching
 * @returns {Promise<Array>} Promotion banners
 */
const getPromotionBanners = async () => {
    try {
        const cacheKey = CACHE_KEYS.PROMOTIONS;
        logger.debug(`Caching Promotion Banners with key: ${cacheKey} & TTL: ${config.cache.promotions}`);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const banners = await queryAll(
                    `SELECT * FROM ${TABLES.BANNERS} WHERE type = ?`,
                    [BANNER_TYPES.PROMOTION]
                );
                return banners;
            },
            config.cache.promotions
        );
    } catch (error) {
        logError(error, { context: 'getPromotionBanners' });
        return [];
    }
};

/**
 * Get promotional banners with caching
 */
const getPromotionalBanners = async () => {
    try {
        const cacheKey = CACHE_KEYS.BANNER_CATALOG();

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const banners = await queryAll(`
                    SELECT title, url, actiontype, description FROM ${TABLES.BANNERS}
                    WHERE type = '${BANNER_TYPES.PROMOTION}'
                    ORDER BY created_at DESC
                    LIMIT 10
                `);

                return banners;
            },
            86400 // 1 day
        );
    } catch (error) {
        logError(error, { context: 'getPromotionalBanners' });
        return [];
    }
};

/**
 * Get ads settings with caching
 * @returns {Promise<Array>} Ads settings
 */
const getAdsSettings = async () => {
    try {
        const cacheKey = CACHE_KEYS.ADS_SETTINGS;
        logger.debug(`Caching Ads Settings with key: ${cacheKey} & TTL: ${config.cache.adsSettings}`);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const settings = await queryAll('SELECT * FROM ads_settings');
                return settings;
            },
            config.cache.adsSettings
        );
    } catch (error) {
        logError(error, { context: 'getAdsSettings' });
        return [];
    }
};

/**
 * Clear banner and ads cache (useful for admin updates)
 * @returns {Promise<boolean>} Success status
 */
const clearCache = async () => {
    try {
        await cache.del(CACHE_KEYS.PROMOTIONS);
        await cache.del(CACHE_KEYS.ADS_SETTINGS);
        return true;
    } catch (error) {
        logError(error, { context: 'clearBannerCache' });
        return false;
    }
};

/**
 * Get user's joined matches with all related data in ONE optimized query
 * This replaces 20+ queries in the original code
 */
const getUserJoinedMatches = async (userId) => {
    try {
        const cacheKey = CACHE_KEYS.USER_MATCHES_AGGREGATE(userId);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const query = `
                    SELECT DISTINCT
                        m.match_id, m.title, m.short_title, m.subtitle, m.status, m.status_str, m.timestamp_start,
                        m.timestamp_end, m.game_state, m.game_state_str, m.current_status, m.competition_id, m.format_str,
                        m.format, m.event_name, m.last_match_played, m.is_free,
                        
                        -- Team A data
                        ta.team_id as teama_id,
                        ta.name as teama_name,
                        ta.short_name as teama_short_name,
                        ta.logo_url as teama_logo_url,
                        
                        -- Team B data
                        tb.team_id as teamb_id,
                        tb.name as teamb_name,
                        tb.short_name as teamb_short_name,
                        tb.logo_url as teamb_logo_url,
                        
                        -- Competition data
                        comp.title as league_title,
                        
                        -- User's winning amount (normal contests)
                        COALESCE(SUM(CASE 
                            WHEN jc.cancel_contest = 0 AND jc.winning_amount > 0 
                            THEN jc.winning_amount 
                            ELSE 0 
                        END), 0) as normal_winning,
                        
                        -- User's teams count
                        (SELECT COUNT(*) FROM ${TABLES.CREATE_TEAMS} ct 
                         WHERE ct.user_id = ? AND ct.match_id = m.match_id) as total_teams,
                        
                        -- User's normal contests count
                        (SELECT COUNT(DISTINCT contest_id) FROM ${TABLES.JOIN_CONTESTS} jc2
                         WHERE jc2.user_id = ? AND jc2.match_id = m.match_id) as total_contests,
                        
                        -- User's master contests count
                        (SELECT COUNT(*) FROM ${TABLES.MASTER_JOIN_CONTESTS} mjc
                         WHERE mjc.user_id = ? AND mjc.match_id = m.match_id) as total_master_contests,
                        
                        -- Master contest prize amount
                        (SELECT COALESCE(SUM(prize_amount), 0) 
                         FROM ${TABLES.MASTER_JOIN_CONTESTS} mjc2
                         WHERE mjc2.user_id = ? 
                         AND mjc2.match_id = m.match_id 
                         AND mjc2.cancel_contest = 0 
                         AND mjc2.prize_amount > 0) as master_winning,
                        
                        -- Lineup count
                        (SELECT COUNT(*) FROM ${TABLES.TEAM_A_SQUADS} tas
                         WHERE tas.match_id = m.match_id AND tas.playing11 = 'true') as lineup_count,
                        
                        -- Player count
                        (SELECT COUNT(*) FROM ${TABLES.MASTER_PLAYER} mp
                         WHERE mp.match_id = m.match_id) as player_count,
                        
                        -- Latest update timestamp
                        GREATEST(
                            COALESCE(MAX(ct2.updated_at), '1970-01-01'),
                            COALESCE(MAX(mjc3.updated_at), '1970-01-01')
                        ) as last_updated
                        
                    FROM ${TABLES.MATCHES} m
                    
                    -- Join with user's teams
                    INNER JOIN ${TABLES.CREATE_TEAMS} ct2 
                        ON m.match_id = ct2.match_id AND ct2.user_id = ?
                    
                    -- Left join with contests
                    LEFT JOIN ${TABLES.JOIN_CONTESTS} jc 
                        ON m.match_id = jc.match_id AND jc.user_id = ?
                    
                    -- Left join with master contests
                    LEFT JOIN ${TABLES.MASTER_JOIN_CONTESTS} mjc3 
                        ON m.match_id = mjc3.match_id AND mjc3.user_id = ?
                    
                    -- Team data
                    LEFT JOIN ${TABLES.TEAM_A} ta ON m.match_id = ta.match_id
                    LEFT JOIN ${TABLES.TEAM_B} tb ON m.match_id = tb.match_id
                    
                    -- Competition data
                    LEFT JOIN ${TABLES.COMPETITIONS} comp ON m.competition_id = comp.cid
                    
                    WHERE m.status IN (1, 2, 3, 4)
                    
                    GROUP BY m.match_id
                    ORDER BY last_updated DESC, m.timestamp_start ASC
                    LIMIT 5
                `;

                // Execute with userId repeated for all subqueries
                const matches = await queryAll(query, [
                    userId, userId, userId, userId, userId, userId, userId
                ]);

                return matches;
            },
            300
        );
    } catch (error) {
        logError(error, { context: 'getUserJoinedMatches', userId });
        return [];
    }
};

/**
 * Transform match data with status calculation
 */
const transformMatchData = (match) => {
    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = Math.round((match.timestamp_start - currentTime) / 60);

    // Calculate total winning amount
    const totalWinning = parseFloat(match.normal_winning || 0) + parseFloat(match.master_winning || 0);
    const formattedWinning = totalWinning.toFixed(2);

    // Determine status string
    let statusStr = match.status_str;
    let status = match.status;

    if (match.timestamp_end < currentTime) {
        if (match.status === 4) {
            statusStr = 'Abandoned';
        } else if (match.current_status === 1) {
            statusStr = 'Completed';
        }
    } else if (match.current_status === 1) {
        statusStr = 'Completed';
    } else if (match.status === 4) {
        statusStr = 'Abandoned';
    } else if (match.status === 2) {
        if (match.current_status === 0) {
            statusStr = 'In Review';
        } else {
            statusStr = 'Completed';
        }
    } else if (match.status === 1 || (match.status === 3 && timeDiff > 0)) {
        statusStr = 'Upcoming';
        status = 1;
    }

    // Parse last match played
    let lastMatchPlayed = match.last_match_played;
    try {
        const decoded = lastMatchPlayed ? JSON.parse(lastMatchPlayed) : null;
        if (!decoded || (Array.isArray(decoded) && decoded.length === 0)) {
            lastMatchPlayed = '[{"player_id":null,"title":"Last match played data is not available"}]';
        }
    } catch (e) {
        lastMatchPlayed = '[{"player_id":null,"title":"Last match played data is not available"}]';
    }

    return {
        match_id: match.match_id,
        title: match.title,
        short_title: match.short_title,
        subtitle: match.subtitle,
        status,
        status_str: statusStr,
        timestamp_start: match.timestamp_start,
        timestamp_end: match.timestamp_end,
        game_state: match.game_state,
        game_state_str: match.game_state_str,
        current_status: match.current_status,
        competition_id: match.competition_id,
        format_str: match.format_str,
        format: match.format,
        event_name: match.event_name,
        last_match_played: lastMatchPlayed,
        league_title: match.league_title,

        // User-specific data
        winning_amount: formattedWinning,
        prize_amount: formattedWinning,
        total_joined_team: parseInt(match.total_teams || 0),
        total_join_contests: parseInt(match.total_contests || 0),
        total_master_contests: parseInt(match.total_master_contests || 0),

        // Match metadata
        is_lineup: parseInt(match.lineup_count || 0) > 1,
        single_player_available: parseInt(match.player_count || 0),
        has_free_contest: match.is_free === 1,

        // Existence flags
        isMasterExist: status === 1 ? 1 : parseInt(match.total_master_contests || 0),
        isNormalExist: status === 1 ? 1 : parseInt(match.total_contests || 0),

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
};

/**
 * Format banner URLs
 */
const formatBannerUrls = (banners, baseUrl) => {
    return banners.map(banner => ({
        ...banner,
        url: banner.url.startsWith('http') ? banner.url : `${baseUrl}${banner.url}`,
    }));
};

/**
 * Get user's banner feed
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Banner data
 */
const getBanners = async (userId) => {
    const startTime = Date.now();

    try {
        const cacheKey = CACHE_KEYS.USER_BANNER_FEED(userId);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const [matches, banners, appMaintenance] = await Promise.all([
                    getUserJoinedMatches(userId),
                    getPromotionalBanners(),
                    getFantasyKey('APP_MAINTAINANCE'),
                ]);

                const response = {
                    matchdata: []
                };

                // Add joined matches section
                if (matches && matches.length > 0) {
                    const transformedMatches = matches.map(match => transformMatchData(match));

                    response.matchdata.push({
                        viewType: 1,
                        joinedmatches: transformedMatches
                    });
                }

                // Add banners section
                if (banners && banners.length > 0) {
                    const formattedBanners = formatBannerUrls(
                        banners,
                        config.app.baseUrl || 'https://api.yourdomain.com'
                    );

                    response.matchdata.push({
                        viewType: 2,
                        banners: formattedBanners
                    });
                }

                // Build final response
                const result = {
                    maintainance: appMaintenance == 1,
                    session_expired: false,
                    status: true,
                    code: 200,
                    message: 'success',
                    response
                };

                logger.info('Banner feed generated', {
                    userId,
                    matchCount: matches.length,
                    bannerCount: banners.length,
                    duration: Date.now() - startTime
                });

                return result;
            },
            120 // Cache for 2 minutes (balance between freshness and performance)
        );
    } catch (error) {
        logError(error, { context: 'getBanners', userId });

        return {
            maintainance: false,
            session_expired: false,
            status: false,
            code: 500,
            message: 'Failed to fetch banner data',
            response: {
                matchdata: []
            },
            _meta: {
                processing_time_ms: Date.now() - startTime,
                error: true,
                version: 'v2'
            }
        };
    }
};

module.exports = {
    getPromotionBanners,
    getAdsSettings,
    clearCache,
    getBanners
};