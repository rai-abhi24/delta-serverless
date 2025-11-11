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
            queueLimit: config.database.queueLimit,
            connectTimeout: config.database.connectTimeout,
            waitForConnections: config.database.waitForConnections,
            enableKeepAlive: config.database.enableKeepAlive,
            keepAliveInitialDelay: config.database.keepAliveInitialDelay,
            timezone: config.database.timezone,
            decimalNumbers: true,
            supportBigNumbers: true,
            dateStrings: false,
            multipleStatements: false, // Security: prevent SQL injection
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
        connection.release();
        return true;
    } catch (error) {
        logError(error, { context: 'health_check' });
        return false;
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
