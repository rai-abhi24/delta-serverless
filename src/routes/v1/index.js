
const schemas = require('../../schemas');
const { authenticate } = require('../../middlewares/auth.middleware');
const { bannerHandler } = require('../../handlers/banner.handler');
const { getMatchHandler, getMatchHistoryHandler } = require('../../handlers/match.handler');
const { apkUpdateHandler, getStoriesHandler, getRecentWinnersHandler } = require('../../handlers/basic.handler');
const { getContestByMatchHandler } = require('../../handlers/contest.handler');
const { loginHandler, logoutHandler } = require('../../handlers/auth.handler');

module.exports = async (app) => {
    /* Auth routes */
    app.post("/loginByMobileNumber", { schema: schemas.loginSchema }, loginHandler);
    app.post("/logout", { preHandler: authenticate }, logoutHandler);

    /* Basic routes */
    app.post("/apkUpdate", { schema: schemas.apkUpdateSchema }, apkUpdateHandler);
    app.get("/getStories", { schema: schemas.getStoriesSchema }, getStoriesHandler);
    app.get("/getRecentWinners", { schema: schemas.getRecentWinnersSchema }, getRecentWinnersHandler);

    /* Banner routes */
    app.post("/getBanners", { schema: schemas.getBannersSchema }, bannerHandler);

    /* Match routes */
    app.post("/getMatch", { schema: schemas.getMatchSchema }, getMatchHandler);
    app.post("/getMatchHistory", { schema: schemas.getMatchHistorySchema }, getMatchHistoryHandler);

    /* Contest routes */
    app.post("/getContestByMatch", { schema: schemas.getContestByMatchSchema }, getContestByMatchHandler);

    /* Wallet routes */
    app.post("/getWallet", { schema: schemas.getWalletSchema }, getWalletHandler);
};