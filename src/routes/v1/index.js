const { apkUpdateHandler } = require('../../handlers/apkUpdate.handler');
const { getMatchHandler } = require('../../handlers/match.handler');
const {
    apkUpdateSchema,
    getMatchSchema
} = require('../../schemas');

module.exports = async (app) => {
    // APK update endpoint
    app.post("/apkUpdate", { schema: apkUpdateSchema }, apkUpdateHandler);

    // Match endpoints
    app.post("/getMatch", { schema: getMatchSchema }, getMatchHandler);
};