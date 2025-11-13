exports.apkUpdateSchema = {
    schema: {
        body: {
            type: 'object',
            required: ['user_id', 'version_code'],
            properties: {
                user_id: { type: 'string' },
                version_code: { type: 'number' },
                os_type: { type: 'string' },
                latitude: { type: 'string' },
                longitude: { type: 'string' },
            },
            additionalProperties: false
        },
    },
};

exports.getMatchSchema = {
    schema: {
        querystring: {
            type: 'object',
            properties: {
                page: { type: 'number' }
            }
        },
        body: {
            type: 'object',
            required: ['user_id'],
            properties: {
                user_id: { type: 'string' },
                device_id: { type: 'string' }
            },
            additionalProperties: false
        }
    }
};

exports.getMatchHistorySchema = {
    schema: {
        querystring: {
            type: 'object',
            properties: {
                page: { type: 'number' }
            }
        },
        body: {
            type: 'object',
            required: ['user_id', 'action_type'],
            properties: {
                user_id: { type: 'string' },
                action_type: { type: 'string', enum: ['upcoming', 'completed', 'live'] }
            },
            additionalProperties: false
        }
    }
};

exports.getBannersSchema = {
    schema: {
        body: {
            type: 'object',
            required: ['user_id'],
            properties: {
                user_id: { type: 'string' },
                device_id: { type: 'string' }
            },
            additionalProperties: false
        },
    },
};

exports.getContestByMatchSchema = {
    schema: {
        body: {
            type: 'object',
            required: ['match_id', 'user_id'],
            properties: {
                match_id: { type: 'string' },
                user_id: { type: 'string' },
            },
            additionalProperties: false
        },
    },
};

exports.loginSchema = {
    schema: {
        body: {
            type: 'object',
            required: ['mobile_number', 'password', 'device_token'],
            properties: {
                mobile_number: { type: 'string', minLength: 10, maxLength: 15 },
                password: { type: 'string', minLength: 4 },
                device_token: { type: 'string' },
            },
            additionalProperties: false
        },
    },
};