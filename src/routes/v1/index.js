
const schemas = require('../../schemas');
const { authenticate } = require('../../middlewares/auth.middleware');
const { bannerHandler } = require('../../handlers/banner.handler');
const { getMatchHandler, getMatchHistoryHandler } = require('../../handlers/match.handler');
const { apkUpdateHandler, getStoriesHandler, getRecentWinnersHandler } = require('../../handlers/basic.handler');
const { getContestByMatchHandler } = require('../../handlers/contest.handler');
const { loginHandler, logoutHandler } = require('../../handlers/auth.handler');
const { getWalletHandler } = require('../../handlers/wallet.handler');

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
    app.post("/getMatchHistory", {
        preHandler: authenticate,
        schema: schemas.getMatchHistorySchema
    }, getMatchHistoryHandler);

    /* Contest routes */
    app.post("/getContestByMatch", { schema: schemas.getContestByMatchSchema }, getContestByMatchHandler);

    /* Wallet routes */
    app.post("/getWallet", { schema: schemas.getWalletSchema }, getWalletHandler);

    // ============================================
    // TODO: Below routes are not implemented yet
    // ============================================
    /* Duo routes */
    app.post("/getDuoPlayers",
        { schema: schemas.getDuoSchema },
        async (_request, reply) => {
            return reply.send({
                "status": true,
                "code": 200,
                "duoContests": {
                    "duoPlayers": []
                },
                "message": "Player fetched successfully!"
            });
        }
    );
};