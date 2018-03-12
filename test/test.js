'use strict'

const assert = require('assert')
const { sanitizeEventLog, compareJson } = require('./test-utils')

const appCommon = require('../app-common')
const config = require('./test-config.json')
const BotEngine = require('../engine/bot-engine')
BotEngine.debugDelay = true
const PredefinedVariables = BotEngine.PredefinedVariables
const fb = require('../engine/fb')

appCommon.run(
    async (storage) => {
        let fbTests = require('./test-data/fb-tests.json')

        let testNames = process.argv.slice(2)
        if (testNames.length === 0) {
            testNames = Object.keys(fbTests)
        }

        for (let testName of testNames) {
            let test = fbTests[testName]
            if (!test) {
                throw new Error(`Missing test: ${testName}`)
            }

            let botDefinition = undefined
            if (test.bot_file) {
                botDefinition = require(test.bot_file)
            } else if (test.bot) {
                botDefinition = test.bot
            } else {
                assert.fail(`No bot or bot_file in test ${testName}`)
            }

            console.info(`Running test: ${testName}`)

            await storage.testOnly.clearStorage()
            let messagesSent = {
                messages: []
            }
            let checkMessages = async (messagesSent, expectedMessagesSent) => {
                if (!expectedMessagesSent) {
                    messagesSent.messages = []
                    return
                }
                compareJson(testName, messagesSent.messages, expectedMessagesSent);
                messagesSent.messages = []
                for (let entry of await storage.testOnly.getMessageLog("1")) {
                    console.log(JSON.stringify(entry))
                }
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
                logger: { log: console.log },
                scheduler: scheduler,
                pluginManager: {}
            }

            let botEngine = new BotEngine(botDefinition, appContext)

            await botEngine.initEngine(messengerApi)

            if (test.script) {
                for (let command of test.script) {
                    let c = createContext(command.user_id || "1");
                    if (command.goto) {
                        await botEngine.testOnly.startWithBlock(c, command.goto)
                    } else if (command.request) {
                        await fb.testOnly.handleRequest(
                            {body: command.request},
                            botEngine,
                            scheduler,
                            createContext
                        )
                    }
                    if (typeof command.print === 'string') {
                        let text = await botEngine.testOnly.substituteText(c, command.print)
                        console.log(text)
                    }
                    if (command.check && command.check.regex) {
                        let text = await botEngine.testOnly.substituteText(c, command.check.value)
                        if (!text.match(command.check.regex)) {
                            throw new Error(`${text} does not match regex:${command.check.regex}`)
                        }
                    }
                    await checkMessages(messagesSent, command.expected_messages_sent)
                    if (command.expected_log) {
                        let events = []
                        await appContext.storage.processEvents(e => events.push(e))
                        compareJson(testName, sanitizeEventLog(events), command.expected_log)
                    }
                }
            } else if (test.request) {
                await fb.testOnly.handleRequest(
                    {body: test.request},
                    botEngine,
                    scheduler,
                    createContext
                )
                await checkMessages(messagesSent, test.expected_messages_sent)
            } else {
                await botEngine.testOnly.startWithBlock(
                    createContext("1"),
                    BotEngine.PredefinedBlocks.ON_START
                )
                await checkMessages(messagesSent, test.expected_messages_sent)
            }

            console.log(`Test ${testName} passed`)
        }

        return appCommon.DONE
    },
    () => {}
)