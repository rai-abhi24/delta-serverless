
const schemas = require('../../schemas');
const { authenticate } = require('../../middlewares/auth.middleware');
const { bannerHandler } = require('../../handlers/banner.handler');
const { getMatchHandler, getMatchHistoryHandler } = require('../../handlers/match.handler');
const { apkUpdateHandler, getStoriesHandler, getRecentWinnersHandler, deviceNotificationHandler } = require('../../handlers/basic.handler');
const { getContestByMatchHandler, getMyContestHandler, getAllContestByMatchHandler } = require('../../handlers/contest.handler');
const { loginHandler, logoutHandler } = require('../../handlers/auth.handler');
const { getWalletHandler } = require('../../handlers/wallet.handler');
const { getMyTeamHandler } = require('../../handlers/team.handler');

module.exports = async (app) => {
    /* Auth routes */
    app.post("/loginByMobileNumber", { schema: schemas.loginSchema }, loginHandler);

    app.post("/logout", {
        preHandler: authenticate
    }, logoutHandler);

    /* Basic routes */
    app.post("/apkUpdate", {
        schema: schemas.apkUpdateSchema
    }, apkUpdateHandler);

    app.get("/getStories", {
        preHandler: authenticate,
        schema: schemas.getStoriesSchema
    }, getStoriesHandler);

    app.get("/getRecentWinners", {
        preHandler: authenticate,
        schema: schemas.getRecentWinnersSchema
    }, getRecentWinnersHandler);

    app.post("/deviceNotification", {
        preHandler: authenticate,
        schema: schemas.deviceNotificationSchema
    }, deviceNotificationHandler);

    /* Banner routes */
    app.post("/getBanners", {
        preHandler: authenticate,
        schema: schemas.getBannersSchema
    }, bannerHandler);

    /* Match routes */
    app.post("/getMatch", {
        preHandler: authenticate,
        schema: schemas.getMatchSchema
    }, getMatchHandler);

    app.post("/getMatchHistory", {
        preHandler: authenticate,
        schema: schemas.getMatchHistorySchema
    }, getMatchHistoryHandler);

    /* Contest routes */
    app.post("/getContestByMatch", {
        preHandler: authenticate,
        schema: schemas.getContestByMatchSchema
    }, getContestByMatchHandler);

    app.post("/getAllContestByMatch", {
        schema: schemas.getContestByMatchSchema
    }, getAllContestByMatchHandler);

    app.post("/getMyContest", {
        preHandler: authenticate,
        schema: schemas.getMyContestSchema
    }, getMyContestHandler);

    /* Team routes */
    app.post("/getMyTeam", {
        preHandler: authenticate,
        schema: schemas.getMyTeamSchema
    }, getMyTeamHandler);

    /* Wallet routes */
    app.post("/getWallet", {
        preHandler: authenticate,
        schema: schemas.getWalletSchema
    }, getWalletHandler);

    // ============================================
    // TODO: Below routes are not implemented yet
    // ============================================
    /* Duo routes */
    app.post("/getDuoPlayers", {
        preHandler: authenticate,
        schema: schemas.getDuoSchema
    }, async (_request, reply) => {
        return reply.send({
            "status": true,
            "code": 200,
            "duoContests": {
                "duoPlayers": []
            },
            "message": "Player fetched successfully!"
        });
    });

    app.post("/getLevelReward", {
        preHandler: authenticate,
        schema: schemas.getWalletSchema
    }, async (_request, reply) => {
        return reply.send({
            "status": true,
            "code": 200,
            "messgae": "Level reward data fethed successfully",
            "is_level_reward_completed": 1,
            "data": ""
        });
    });

    app.post("/getExpertGuruTeams", {
        preHandler: authenticate,
        schema: schemas.getWalletSchema
    },
        async (_request, reply) => {
            return reply.send({
                "system_time": Math.floor(Date.now() / 1000),
                "match_status": null,
                "match_time": null,
                "status": true,
                "code": 200,
                "teamCount": 0,
                "message": "success",
                "response": {
                    "myteam": []
                }
            });
        }
    );
};