
const schemas = require('../../schemas');
const { bannerHandler } = require('../../handlers/banner.handler');
const { getMatchHandler } = require('../../handlers/match.handler');
const { apkUpdateHandler } = require('../../handlers/apkUpdate.handler');
const { getContestByMatchHandler } = require('../../handlers/contest.handler');

module.exports = async (app) => {
    // APK update endpoint
    app.post("/apkUpdate", { schema: schemas.apkUpdateSchema }, apkUpdateHandler);

    // Banner endpoint
    app.post("/getBanners", { schema: schemas.getBannersSchema }, bannerHandler);

    // Match endpoints
    app.post("/getMatch", { schema: schemas.getMatchSchema }, getMatchHandler);

    // Contest endpoints
    app.post("/getContestByMatch", { schema: schemas.getContestByMatchSchema }, getContestByMatchHandler);
};