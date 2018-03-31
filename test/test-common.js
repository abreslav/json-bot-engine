'use strict'

const config = require('./test-config.json')
const mongoStorage = require('../engine/mongo-storage')(config)

const BotEngine = require('../engine/bot-engine')
BotEngine.debugDelay = true
const PredefinedVariables = BotEngine.PredefinedVariables
const fb = require('../engine/facebook')(config)

module.exports.withTestEnvironment = (testBody /* async (storage, createBotDefinition, fb) */) => {
    mongoStorage.connect(
        async (storage) => {
            await testBody(
                storage,
                async (botDefinition) => await createBotEngine(storage, botDefinition),
                fb
            )
        },
        () => {}
    )
}

async function createBotEngine(storage, botDefinition) {
    await storage.testOnly.clearStorage()
    let messagesSent = {
        messages: []
    }

    let messengerApi = {
        messenger: "facebook",
        processInitInstruction: (instr, callback) => {
            let msg = Object.assign({}, instr)
            delete msg.messenger
            messagesSent.messages.push(msg)
            if (callback) callback()
        }
    }
    let createContext = (userId) => {
        return {
            sender: {
                sendMessage: async (load) => {
                    messagesSent.messages.push(load)
                },
                sendDebugMessage: async (text) => {
                    // no action
                },
                fetchUserVariables: async () => {
                    let result = {}
                    result[PredefinedVariables.server_base_url] = config.http.base_url
                    result[PredefinedVariables.messenger_user_id] = userId
                    result[PredefinedVariables.user_first_name] = "First"
                    result[PredefinedVariables.user_last_name] = "Last"
                    result[PredefinedVariables.user_pic_url] = "http://user.pic.url.com"
                    result[PredefinedVariables.locale] = "en_US"
                    result[PredefinedVariables.timezone] = "2"
                    return result
                }
            },
            messengerApi: messengerApi,
            userId: userId,
            messageBuilder: fb.testOnly.MessageBuilder,
            mailer: {
                sendEmail: async (emailTo, subject, body) => {
                    messagesSent.messages.push({
                        email_to: emailTo,
                        subject: subject,
                        body: body
                    })
                    return {
                        info: "OK"
                    }
                }
            }
        }
    }
    let scheduler = {
        schedule: async (timeSlice, triggerName, payload) => {
            console.log(`SCHEDULED: ${triggerName} ${JSON.stringify(payload)}`)
        }
    }
    let appContext = {
        storage: storage,
        logger: {log: (msg, json) => {
                if (msg === "User Event") {
                    messagesSent.messages.push(json)
                }
            }},
        scheduler: scheduler,
        pluginManager: {}
    }

    let botEngine = new BotEngine(botDefinition, appContext)

    await botEngine.initEngine(messengerApi)
    return {messagesSent, createContext, scheduler, appContext, botEngine};
}