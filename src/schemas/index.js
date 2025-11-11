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