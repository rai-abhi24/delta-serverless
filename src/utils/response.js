/**
 * Standardized API response helpers
 * Ensures consistent response format across all endpoints
 */

const { HTTP_STATUS } = require('./constants');

/**
 * Create a success response
 * @param {Object} reply - Fastify reply object
 * @param {any} data - Response data
 * @param {number} statusCode - HTTP status code
 * @returns {Object} Fastify reply
 */
const success = (reply, data, statusCode = HTTP_STATUS.OK) => {
    return reply.code(statusCode).send({
        status: true,
        code: statusCode,
        ...data,
    });
};

/**
 * Create an error response
 * @param {Object} reply - Fastify reply object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @param {Object} additional - Additional error data
 * @returns {Object} Fastify reply
 */
const error = (reply, message, statusCode = HTTP_STATUS.INTERNAL_ERROR, additional = {}) => {
    return reply.code(statusCode).send({
        status: false,
        code: statusCode,
        message,
        ...additional,
    });
};

/**
 * Create a validation error response
 * @param {Object} reply - Fastify reply object
 * @param {Array|string} errors - Validation errors
 * @returns {Object} Fastify reply
 */
const validationError = (reply, errors) => {
    return reply.code(HTTP_STATUS.BAD_REQUEST).send({
        status: false,
        code: HTTP_STATUS.BAD_REQUEST,
        message: 'Validation failed',
        errors: Array.isArray(errors) ? errors : [errors],
    });
};

/**
 * Create an unauthorized response
 * @param {Object} reply - Fastify reply object
 * @param {string} message - Error message
 * @returns {Object} Fastify reply
 */
const unauthorized = (reply, message = 'Unauthenticated') => {
    return reply.code(HTTP_STATUS.OK).send({
        status: true,
        code: HTTP_STATUS.OK,
        session_expired: true,
        message: 'Unauthenticated',
        url: "https://gamezone-assets.s3.ap-south-1.amazonaws.com/delta11/delta11.apk",
        title: "App Update",
        release_note: null,
        promotion: null,
        ads_setting: null
    });
};

/**
 * Create a not found response
 * @param {Object} reply - Fastify reply object
 * @param {string} message - Error message
 * @returns {Object} Fastify reply
 */
const notFound = (reply, message = 'Resource not found') => {
    return error(reply, message, HTTP_STATUS.NOT_FOUND);
};

/**
 * Create a service unavailable response
 * @param {Object} reply - Fastify reply object
 * @param {string} message - Error message
 * @returns {Object} Fastify reply
 */
const serviceUnavailable = (reply, message = 'Service temporarily unavailable') => {
    return error(reply, message, HTTP_STATUS.SERVICE_UNAVAILABLE);
};

module.exports = {
    success,
    error,
    validationError,
    unauthorized,
    notFound,
    serviceUnavailable,
};