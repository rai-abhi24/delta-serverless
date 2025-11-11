/**
 * MySQL database connection pool optimized for Lambda
 * Uses connection pooling with RDS Proxy for optimal performance
 */

const mysql = require('mysql2/promise');
const config = require('../config');
const { logger, logQuery, logError } = require('../utils/logger');

let pool = null;

/**
 * Get or create database connection pool
 * Reuses pool across Lambda invocations for optimal performance
 * @returns {Promise<import('mysql2').Pool>} MySQL connection pool
 */
const getPool = async () => {
    if (pool) {
        return pool;
    }

    try {
        pool = mysql.createPool({
            host: config.database.host,
            port: config.database.port,
            database: config.database.database,
            user: config.database.user,
            password: config.database.password,

            connectionLimit: config.database.connectionLimit,
            queueLimit: 10,

            connectTimeout: 3000,
            acquireTimeout: 3000,

            waitForConnections: true,
            enableKeepAlive: true,
            keepAliveInitialDelay: 10_000,

            maxIdle: 10,
            idleTimeout: 60_000,

            timezone: config.database.timezone || '+00:00',
            decimalNumbers: true,
            supportBigNumbers: true,
            dateStrings: false,
            multipleStatements: false,

            cache: true,
            compress: true,
            charset: 'utf8mb4_unicode_ci',
        });

        pool.on('acquire', () => {
            logger.debug('Connection acquired from pool');
        });

        pool.on('release', () => {
            logger.debug('Connection released back to pool');
        });

        pool.on('enqueue', () => {
            logger.warn('Waiting for available connection slot');
        });

        // Test connection on initialization
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();

        logger.info('Database pool created successfully');
        return pool;
    } catch (error) {
        logError(error, { context: 'database_pool_creation' });
        throw new Error('Failed to create database pool');
    }
};

/**
 * Execute a database query with automatic connection handling
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Query results
 */
const executeQuery = async (query, params = []) => {
    const startTime = Date.now();
    let connection;

    try {
        const dbPool = await getPool();
        connection = await dbPool.getConnection();

        const [rows] = await connection.execute(query, params);

        const duration = Date.now() - startTime;
        logQuery(query, params, duration);

        return rows;
    } catch (error) {
        logError(error, {
            context: 'query_execution',
            query: query.substring(0, 200),
            paramCount: params.length,
        });
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

/**
 * Execute a query and return first row
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object|null>} First row or null
 */
const queryOne = async (query, params = []) => {
    const rows = await executeQuery(query, params);
    return rows.length > 0 ? rows[0] : null;
};

/**
 * Execute a query and return all rows
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} All rows
 */
const queryAll = async (query, params = []) => {
    return executeQuery(query, params);
};

/**
 * Execute a transaction with automatic rollback on error
 * @param {Function} callback - Transaction callback function
 * @returns {Promise<any>} Transaction result
 */
const executeTransaction = async (callback) => {
    const dbPool = await getPool();
    const connection = await dbPool.getConnection();

    try {
        await connection.beginTransaction();

        const result = await callback(connection);

        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        logError(error, { context: 'transaction_execution' });
        throw error;
    } finally {
        connection.release();
    }
};

/**
 * Check database health
 * @returns {Promise<boolean>} True if healthy
 */
const checkHealth = async () => {
    try {
        const dbPool = await getPool();
        const connection = await dbPool.getConnection();

        await connection.ping();

        const poolStats = {
            activeConnections: dbPool.pool._allConnections.length - dbPool.pool._freeConnections.length,
            freeConnections: dbPool.pool._freeConnections.length,
            totalConnections: dbPool.pool._allConnections.length,
            queueLength: dbPool.pool._connectionQueue.length,
        };

        connection.release();

        logger.info('Database health check passed', poolStats);
        return { healthy: true, stats: poolStats };
    } catch (error) {
        logError(error, { context: 'health_check' });
        return { healthy: false, error: error.message };
    }
};

/**
 * Close database pool (for cleanup)
 */
const closePool = async () => {
    if (pool) {
        await pool.end();
        pool = null;
        logger.info('Database pool closed');
    }
};

module.exports = {
    getPool,
    executeQuery,
    queryOne,
    queryAll,
    executeTransaction,
    checkHealth,
    closePool,
};
