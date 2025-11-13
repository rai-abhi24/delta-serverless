/**
 * Wallet Service
 */

const cache = require('../utils/cache');
const { queryAll, queryOne } = require('../config/database');
const { TABLES } = require('../utils/tablesNames');
const { CACHE_KEYS, CACHE_EXPIRY } = require('../utils/constants');
const { logError } = require('../utils/logger');
const { getFantasyKey } = require('../utils/helper');
const userService = require('./user.service');

/**
 * Get wallet balances by payment type
 * Single query instead of multiple lookups
 */
const getWalletBalances = async (userId) => {
    try {
        const cacheKey = CACHE_KEYS.WALLET_BALANCES(userId);

        const result = await cache.get(cacheKey);
        if (result) return result;

        const wallets = await queryAll(`
            SELECT payment_type, amount
            FROM ${TABLES.WALLETS}
            WHERE user_id = ?
        `, [userId]);

        const balances = {
            bonus_amount: 0,
            prize_amount: 0,
            referral_amount: 0,
            deposit_amount: 0,
            extra_cash: 0,
            wallet_amount: 0
        };

        let walletAmount = 0;

        wallets.forEach(wallet => {
            const amount = parseFloat(wallet.amount || 0);

            switch (wallet.payment_type) {
                case 1:
                    balances.bonus_amount = amount;
                    break;
                case 4:
                    balances.prize_amount = amount;
                    walletAmount += amount;
                    break;
                case 2:
                    balances.referral_amount = amount;
                    break;
                case 3:
                    balances.deposit_amount = amount;
                    walletAmount += amount;
                    break;
                case 9:
                    balances.extra_cash = amount;
                    break;
            }
        });

        balances.wallet_amount = walletAmount;

        const hasBalance = walletAmount > 0;
        const ttl = hasBalance ? CACHE_EXPIRY.THIRTY_SECONDS : CACHE_EXPIRY.TWO_MINUTES;

        await cache.set(cacheKey, balances, ttl);
        return balances;
    } catch (error) {
        logError(error, { context: 'getWalletBalances', userId });
        return {
            bonus_amount: 0,
            prize_amount: 0,
            referral_amount: 0,
            deposit_amount: 0,
            extra_cash: 0,
            wallet_amount: 0
        };
    }
};

/**
 * Get document verification status
 * Dynamic TTL: Verified docs cache longer, pending/rejected shorter
 */
const getDocumentStatus = async (userId) => {
    try {
        const cacheKey = CACHE_KEYS.DOCUMENT_STATUS(userId);

        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        const doc = await queryOne(`
            SELECT status, doc_type, doc_name, doc_number
            FROM ${TABLES.VERIFY_DOCUMENTS}
            WHERE user_id = ?
            AND (doc_type = 'pancard' OR doc_type = 'adharcard')
            LIMIT 1
        `, [userId]);

        let result;
        let ttl;

        if (doc) {
            result = {
                document_verified: doc.status,
                doc_type: doc.doc_type,
                pan_name: doc.doc_name,
                pan_number: doc.doc_number
            };

            // Status: 0=pending, 1=submitted, 2=verified, 3=rejected
            if (doc.status === 2) {
                ttl = CACHE_EXPIRY.WEEK(1);
            } else if (doc.status === 3) {
                ttl = CACHE_EXPIRY.ONE_DAY;
            } else {
                ttl = CACHE_EXPIRY.FIVE_MINUTES;
            }
        } else {
            result = { document_verified: 0 };
            ttl = CACHE_EXPIRY.TWO_MINUTES;
        }

        await cache.set(cacheKey, result, ttl);
        return result;
    } catch (error) {
        logError(error, { context: 'getDocumentStatus', userId });
        return { document_verified: 0 };
    }
};

/**
 * Get bank account verification status
 * Dynamic TTL: Verified banks cache longer
 */
const getBankAccountStatus = async (userId) => {
    try {
        const cacheKey = CACHE_KEYS.BANK_ACCOUNT_STATUS(userId);

        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        const bank = await queryOne(`
            SELECT status, account_number, bank_name, ifsc_code
            FROM ${TABLES.BANK_ACCOUNTS}
            WHERE user_id = ?
            LIMIT 1
        `, [userId]);

        let result;
        let ttl;

        if (bank) {
            result = {
                bank_account_verified: bank.status,
                bank_account_number: bank.account_number,
                bank_name: bank.bank_name,
                ifsc_code: bank.ifsc_code
            };

            // Status: 1=verified, 0=pending
            ttl = bank.status === 1
                ? CACHE_EXPIRY.WEEK(1)
                : CACHE_EXPIRY.ONE_MINUTE;
        } else {
            result = { bank_account_verified: 0 };
            ttl = CACHE_EXPIRY.TWO_MINUTES;
        }

        await cache.set(cacheKey, result, ttl);
        return result;
    } catch (error) {
        logError(error, { context: 'getBankAccountStatus', userId });
        return { bank_account_verified: 0 };
    }
};

/**
 * Get referral friends count
 */
const getReferralCount = async (userId) => {
    try {
        const cacheKey = CACHE_KEYS.REFERRAL_COUNT(userId);

        const cached = await cache.get(cacheKey);
        if (cached !== null) return cached;

        const user = await queryOne(`
            SELECT referal_code
            FROM ${TABLES.USERS}
            WHERE id = ?
            LIMIT 1
        `, [userId]);

        if (!user || !user.referal_code) {
            await cache.set(cacheKey, 0, CACHE_EXPIRY.FIVE_MINUTES);
            return 0;
        }

        const result = await queryOne(`
            SELECT COUNT(*) as count
            FROM ${TABLES.USERS}
            WHERE reference_code = ?
            AND is_account_verified = 1
        `, [user.referal_code]);

        const count = result?.count || 0;

        const ttl = count > 10
            ? CACHE_EXPIRY.ONE_HOUR
            : count > 0
                ? CACHE_EXPIRY.THREE_MINUTES
                : CACHE_EXPIRY.TEN_MINUTES;

        await cache.set(cacheKey, count, ttl);
        return count;
    } catch (error) {
        logError(error, { context: 'getReferralCount', userId });
        return 0;
    }
};

/**
 * Get account verification status breakdown
 * Combines document and bank verification checks
 */
const getAccountVerificationStatus = async (userId) => {
    try {
        const cacheKey = CACHE_KEYS.ACCOUNT_VERIFICATION(userId);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const status = {
                    email_verified: 2,
                    documents_verified: 0,
                    address_verified: 0,
                    paytm_verified: 0
                };

                const docs = await queryAll(`
                    SELECT doc_type, status
                    FROM ${TABLES.VERIFY_DOCUMENTS}
                    WHERE user_id = ?
                `, [userId]);

                docs.forEach(doc => {
                    if (doc.doc_type === 'adharcard' || doc.doc_type === 'pancard') {
                        // Status: 0=pending, 1=submitted, 2=verified, 3=rejected
                        if (doc.status === 2) {
                            status.documents_verified = 2;
                        } else if (doc.status === 1 && status.documents_verified !== 2) {
                            status.documents_verified = 1;
                        } else if (doc.status === 3 && status.documents_verified === 0) {
                            status.documents_verified = 3;
                        }
                    } else if (doc.doc_type === 'paytm') {
                        status.paytm_verified = 2;
                    }
                });

                const bank = await queryOne(`
                    SELECT status
                    FROM ${TABLES.BANK_ACCOUNTS}
                    WHERE user_id = ?
                    LIMIT 1
                `, [userId]);

                if (bank) {
                    status.address_verified = bank.status === 1 ? 2 : 1;
                }

                return status;
            },
            CACHE_EXPIRY.FIVE_MINUTES
        );
    } catch (error) {
        logError(error, { context: 'getAccountVerificationStatus', userId });
        return {
            email_verified: 2,
            documents_verified: 0,
            address_verified: 0,
            paytm_verified: 0
        };
    }
};

/**
 * Get payment gateway settings
 */
const getPaymentGateways = async (platform) => {
    try {
        const cacheKey = CACHE_KEYS.PAYMENT_GATEWAYS(platform);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const settings = await queryAll(`
                    SELECT name, unique_keyword, payment_mode, status
                    FROM ${TABLES.PAYMENT_SETTINGS}
                `);

                const gateways = {};

                settings.forEach(setting => {
                    if (platform === 'IOS') {
                        gateways[setting.name] = {
                            status: setting.status,
                            payment_mode: 'web'
                        };
                    } else {
                        gateways[setting.name] = {
                            status: setting.status,
                            payment_mode: setting.payment_mode
                        };
                    }
                });

                return gateways;
            },
            CACHE_EXPIRY.TEN_MINUTES
        );
    } catch (error) {
        logError(error, { context: 'getPaymentGateways', platform });
        return {};
    }
};

/**
 * Get full wallet information
 * Main entry point - fetches all data in parallel
 */
const getWallet = async (userId, platform = 'ANDROID') => {
    try {
        if (!userId) {
            return {
                status: false,
                code: 201,
                message: 'Wallet not available'
            };
        }

        const cacheKey = CACHE_KEYS.WALLET_FULL(userId, platform);

        return await cache.cacheAside(
            cacheKey,
            async () => {
                const user = await userService.findUserById(userId);

                if (!user) {
                    return {
                        status: false,
                        code: 201,
                        message: 'User Not Found'
                    };
                }

                const [
                    balances,
                    documentStatus,
                    bankStatus,
                    referralCount,
                    verificationStatus,
                    paymentGateways,
                    minDeposit,
                    minWithdrawal,
                    walletTransferOffer,
                    minWalletTransfer,
                    withdrawalTypeEnabled
                ] = await Promise.all([
                    getWalletBalances(userId),
                    getDocumentStatus(userId),
                    getBankAccountStatus(userId),
                    getReferralCount(userId),
                    getAccountVerificationStatus(userId),
                    getPaymentGateways(platform),
                    getFantasyKey('MINIMUM_DEPOSIT'),
                    getFantasyKey('MIN_WITHDRAWAL'),
                    getFantasyKey('WALLET_TRANSFER_OFFER'),
                    getFantasyKey('MINIMUM_WALLET_TRANSFER'),
                    getFantasyKey('WITHDRAWAL_TYPE_ENABLED')
                ]);

                const walletInfo = {
                    ...balances,
                    ...documentStatus,
                    ...bankStatus,
                    refferal_friends_count: referralCount,
                    is_account_verified: verificationStatus,
                    user_id: user.user_name
                };

                return {
                    status: true,
                    code: 200,
                    min_deposit: minDeposit || '0',
                    min_withdrawal: minWithdrawal || '0',
                    phonepe_mobile_sdk: 1,
                    phonepe_playstore_sdk: 1,
                    walletInfo,
                    payment_gateways: paymentGateways,
                    wallet_transfer_offer: parseInt(walletTransferOffer || 0),
                    minimum_wallet_transfer: parseInt(minWalletTransfer || 0),
                    withdrawal_type_enabled: withdrawalTypeEnabled == 1 ? 1 : 0,
                    data: {
                        id: user.id,
                        user_name: user.user_name,
                        name: user.name,
                        email: user.email,
                        mobile_number: user.mobile_number,
                        team_name: user.team_name,
                        rating: user.rating,
                        current_balance: user.current_balance,
                        total_balance: user.total_balance,
                        affiliate_user: user.affiliate_user
                    }
                };
            },
            CACHE_EXPIRY.ONE_MINUTE
        );
    } catch (error) {
        logError(error, { context: 'getWallet', userId });
        return {
            status: false,
            code: 500,
            message: 'Failed to fetch wallet data'
        };
    }
};

module.exports = {
    getWallet
};