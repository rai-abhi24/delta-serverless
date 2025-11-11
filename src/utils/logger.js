/**
 * Structured logging utility using Pino
 * Optimized for CloudWatch Logs with JSON format
 */

const pino = require('pino');
const config = require('../config');

const logger = pino({
    level: config.logging.level,
    formatters: {
        level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'message',
    base: {
        service: 'delta11-serverless',
        env: config.env,
    },
    ...(config.logging.pretty && {
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        },
    }),
});

/**
 * Create a child logger with additional context
 * @param {Object} context - Additional context to include in logs
 * @returns {Object} Child logger instance
 */
const createChildLogger = (context) => {
    return logger.child(context);
};

/**
 * Log request details
 * @param {Object} request - Fastify request object
 */
const logRequest = (request) => {
    logger.info({
        type: 'request',
        method: request.method,
        url: request.url,
        headers: {
            'user-agent': request.headers['user-agent'],
            'content-type': request.headers['content-type'],
        },
        body: request.body,
        query: request.query,
        requestId: request.id,
    }, 'Incoming request');
};

/**
 * Log response details
 * @param {Object} request - Fastify request object
 * @param {Object} reply - Fastify reply object
 * @param {number} duration - Request duration in ms
 */
const logResponse = (request, reply, duration) => {
    logger.info({
        type: 'response',
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        duration,
        requestId: request.id,
    }, 'Request completed');
};

/**
 * Log database query
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @param {number} duration - Query duration in ms
 */
const logQuery = (query, params, duration) => {
    logger.debug({
        type: 'database',
        query: query.substring(0, 200), // Truncate long queries
        paramCount: params?.length || 0,
        duration,
    }, 'Database query executed');
};

/**
 * Log cache operation
 * @param {string} operation - Cache operation (get, set, delete)
 * @param {string} key - Cache key
 * @param {boolean} hit - Whether cache was hit (for get operations)
 * @param {number} duration - Operation duration in ms
 */
const logCache = (operation, key, hit, duration) => {
    logger.debug({
        type: 'cache',
        operation,
        key,
        hit,
        duration,
    }, `Cache ${operation}`);
};

/**
 * Log error with context
 * @param {Error} error - Error object
 * @param {Object} context - Additional context
 */
const logError = (error, context = {}) => {
    logger.error({
        type: 'error',
        error: {
            message: error.message,
            stack: error.stack,
            code: error.code,
            ...context,
        },
    }, error.message);
};

module.exports = {
    logger,
    createChildLogger,
    logRequest,
    logResponse,
    logQuery,
    logCache,
    logError,
};
