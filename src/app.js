/**
 * Delta 11 
 * Fastify Application for serverless backend
 */

const fastify = require("fastify")
const { v4: uuidv4 } = require('uuid');
const { success, error } = require("./utils/response");
const { default: fastifyCors } = require("@fastify/cors");
const { default: fastifyHelmet } = require("@fastify/helmet");
const { default: fastifyCompress } = require("@fastify/compress");
const { logRequest, logResponse, logger } = require("./utils/logger");
const awsLambdaFastify = require('@fastify/aws-lambda');
const v1Routes = require("./routes/v1");

const app = fastify({
    logger: false,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    genReqId: () => uuidv4(),
    disableRequestLogging: true,
    trustProxy: true,
});

app.register(fastifyCors, {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
});

app.register(fastifyHelmet, {
    contentSecurityPolicy: false,
});

app.register(fastifyCompress, {
    global: true,
    threshold: 1024,
    encodings: ['gzip', 'deflate'],
});

app.addHook('onRequest', async (request) => {
    request.startTime = Date.now();
    logRequest(request);
});

app.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - request.startTime;
    logResponse(request, reply, duration);
});

app.get('/health', async (_request, reply) => {
    return success(reply, {
        message: 'OK',
        timestamp: new Date().toISOString(),
    });
});

app.register(v1Routes, { prefix: '/api/v6' });

// Global error handler
app.setErrorHandler((err, request, reply) => {
    if (err.validation) {
        return error(
            reply,
            `Validation failed: ${err.message}`,
            400
        );
    }

    logger.error({
        error: err.message,
        stack: err.stack,
        url: request.url,
        method: request.method,
        requestId: request.id,
    });

    return error(
        reply,
        'An unexpected error occurred',
        500
    );
});

// 404 handler
app.setNotFoundHandler((request, reply) => {
    return error(reply, `Route not found - ${request.url}`, 404);
});

/**
 * Wrap fastify application for Lambda
 */
const proxy = awsLambdaFastify(app);

exports.handler = async (event, context) => {
    // Set context to not wait for event loop to be empty
    context.callbackWaitsForEmptyEventLoop = false;

    try {
        return await proxy(event, context);
    } catch (error) {
        logger.error({
            error: error.message,
            stack: error.stack,
            event: JSON.stringify(event),
        }, 'Lambda handler error');

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                status: false,
                code: 500,
                message: 'Internal server error',
            }),
        };
    }
}