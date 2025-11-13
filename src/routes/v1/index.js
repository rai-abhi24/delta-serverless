
const schemas = require('../../schemas');
const { authenticate } = require('../../middlewares/auth.middleware');
const { bannerHandler } = require('../../handlers/banner.handler');
const { getMatchHandler, getMatchHistoryHandler } = require('../../handlers/match.handler');
const { apkUpdateHandler } = require('../../handlers/apkUpdate.handler');
const { getContestByMatchHandler } = require('../../handlers/contest.handler');
const { loginHandler, logoutHandler } = require('../../handlers/auth.handler');

module.exports = async (app) => {
    // Auth routes
    app.post("/loginByMobileNumber", { schema: schemas.loginSchema }, loginHandler);
    app.post("/logout", { preHandler: authenticate }, logoutHandler);

    // APK update endpoint
    app.post("/apkUpdate", { schema: schemas.apkUpdateSchema }, apkUpdateHandler);

    // Banner endpoint
    app.post("/getBanners", { schema: schemas.getBannersSchema }, bannerHandler);

    // Match endpoints
    app.post("/getMatch", { schema: schemas.getMatchSchema }, getMatchHandler);
    app.post("/getMatchHistory", { schema: schemas.getMatchHistorySchema }, getMatchHistoryHandler);

    // Contest endpoints
    app.post("/getContestByMatch", { schema: schemas.getContestByMatchSchema }, getContestByMatchHandler);
};