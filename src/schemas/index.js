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

exports.getStoriesSchema = {
    schema: {
        body: {
            type: 'object',
            properties: {
                user_id: { type: 'string' }
            },
            additionalProperties: false
        }
    }
};

exports.getRecentWinnersSchema = {
    schema: {
        body: {
            type: 'object',
            properties: {
                user_id: { type: 'string' }
            },
            additionalProperties: false
        }
    }
};

exports.getWalletSchema = {
    schema: {
        body: {
            type: 'object',
            required: ['user_id'],
            properties: {
                user_id: { type: 'string' }
            },
            additionalProperties: false
        }
    }
};

exports.getDuoSchema = {
    schema: {
        body: {
            type: 'object',
            required: ['match_id'],
            properties: {
                match_id: { type: 'string' }
            },
            additionalProperties: false
        }
    }
};

exports.deviceNotificationSchema = {
    schema: {
        body: {
            type: 'object',
            required: ['user_id', 'device_id'],
            properties: {
                user_id: { type: 'string' },
                device_id: { type: 'string', minLength: 1 }
            },
            additionalProperties: false
        }
    }
};

exports.getMyContestSchema = {
    schema: {
        body: {
            type: 'object',
            required: ['match_id', 'user_id'],
            properties: {
                match_id: { type: 'string' },
                user_id: { type: 'string' },
                deviceDetails: {
                    type: 'object',
                    properties: {
                        versionCode: {
                            type: 'number'
                        }
                    }
                }
            },
            additionalProperties: false
        }
    }
};

exports.getMyTeamSchema = {
    schema: {
        body: {
            type: 'object',
            required: ['match_id', 'user_id'],
            properties: {
                match_id: { type: 'string' },
                user_id: { type: 'string' },
                type: {
                    type: 'string',
                    enum: ['close', 'open']
                },
                close_team_id: {
                    type: 'array',
                    items: { type: 'number' }
                },
                open_team_id: {
                    type: 'array',
                    items: { type: 'number' }
                }
            },
            additionalProperties: false
        }
    }
};