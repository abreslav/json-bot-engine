module.exports = (config) => {
    return {
        mongoStorage: require('./engine/mongo-storage')(config),
        BotEngine: require('./engine/bot-engine'),
        mailer: require('./engine/mailgun-mailer')(config),
        Scheduler: require('./engine/scheduler')(config),
        facebook: require('./engine/facebook')(config)
    }
}
