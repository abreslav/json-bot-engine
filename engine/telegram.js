'use strict'

const request = require('request')
const extend = require('extend')

const {PredefinedBlocks, PredefinedVariables} = require("./bot-engine")

module.exports = (config) => {
    let result = {}
    result.testOnly = {}

    result.installWebhook = function (app, path, engine, scheduler) {
        scheduler.registerMessenger(
            TelegramApi.messenger,
            async (userId, payload) => {
                await engine.runScheduledTask(createContext(userId), payload)
            }
        )

        app.post(path, function (req, res) {
            handleRequest(req, engine)
                .then(() => res.sendStatus(200))
        })

        engine.initEngine(TelegramApi)

        // Set up the "Get Started" button
    }

    function createContext(chat_id) {
        return {
            sender: new TelegramSender(chat_id),
            messengerApi: TelegramApi,
            userId: chat_id,
            messageBuilder: MessageBuilder
        }
    }

    async function handleRequest(req, engine, context = createContext) {
        const {message} = req.body;
        const {callback_query} = req.body;
        let c = context(message.chat.id)
        if (message && message.text) {
            let text = message.text
            await engine.textMessageReceived(c, text)
        } else if (callback_query) {
            const payload = parsePayload(callback_query)
            await engine.buttonPressed(c, payload)
        } else if(message && !message.text){
            console.log("Unrecoginzed message received: ", message)
        }


    }

    result.testOnly.handleRequest = handleRequest

    function parsePayload(payloadString) {
        let payload = JSON.parse(payloadString)
        if (Array.isArray(payload.blocks)) {
            return {"goto": payload.blocks[0]}
        }
        return payload
    }

    const TelegramApi = {
        messenger: "telegram",
        processInitInstruction: (instr, callback) => {

        }
    }

    const TelegramSender = function (chat_id) {
        this.sendMessage = async function (load) {
            let json = {}
            extend(json, load, {chat_id: chat_id})
            await telegramPost("https://api.telegram.org/bot" + config.telegram.bot_token + "/sendMessage", json)
        }
        this.fetchUserVariables = async () => {
            let response = await telegramPost(
                "https://api.telegram.org/bot" + config.telegram.bot_token + "/getChatMember")
            if (response && !response.body.error) {
                let fetched = JSON.parse(response.body)
                const user = fetched.user
                let result = {}
                result[PredefinedVariables.server_base_url] = config.http.base_url
                result[PredefinedVariables.messenger_user_id] = user.id
                result[PredefinedVariables.user_first_name] = fetched.first_name
                result[PredefinedVariables.user_last_name] = fetched.last_name
                result[PredefinedVariables.locale] = fetched.language_code
                result[PredefinedVariables.username] = fetched.username
                return result
            }
        }
    }

    const MessageBuilder = {
        text: (text) => {
            return {
                text: text
            }
        },
        image_url: (image_url) => {
            console.log("TODO: images are not yet supported" + image_url)
            return message({text: "TODO: images are not yet supported: " + image_url})
        },
        textWithButtons: (text, buttons) => {
            return {
                text: text,
                reply_markup: inlineKeybordFromButtons(buttons)
            }
        },
        textWithQuickReplies: (text, buttons) => {
            return {
                text: text,
                quick_replies: replyKeybordFromButtons(buttons)
            }
        },
        // gallery: (items, image_aspect_ratio = "square") => {
        //     return message({
        //         attachment: {
        //             type: "template",
        //             payload: {
        //                 template_type: "generic",
        //                 image_aspect_ratio: image_aspect_ratio || "square",
        //                 elements: items.map(toFBGalleryElement)
        //             }
        //         }
        //     })
        // },
    }
    result.testOnly.MessageBuilder = MessageBuilder

    function inlineKeybordFromButtons(buttons) {
        return {
            inline_keyboard: [buttons.map(it => {
                return {
                    text: it["title"],
                    callback_data: it["goto"]
                }
            })]
        }
    }

    function replyKeybordFromButtons(buttons) {
        return {
            keyboard: [buttons.map(it => {
                return {
                    text: it["title"]
                }
            })]
        }
    }

    async function telegramPost(url, json) {
        let jsonRequest = {
            url: url,
            method: 'POST',
            json: json
        };
        return await telegramRequest(jsonRequest);
    }

    function telegramRequest(jsonRequest) {
        return new Promise(resolve => {
            request(
                jsonRequest,
                function (error, response) {
                    if (error) {
                        console.error(`Error sending: ${JSON.stringify(jsonRequest, 1)}:`)
                        console.error("Error: ", error)
                    } else if (response.body.error) {
                        console.log('Error: ', response.body.error)
                        console.log("Request: ", JSON.stringify(jsonRequest))
                    } else {
                        if (config.logging.log_http_requests) {
                            console.log(`Successfully sent: ${JSON.stringify(jsonRequest, 1)}`)
                            if (typeof response.body === 'string') {
                                console.log("Response: ", response.body)
                            } else {
                                console.log("Response: ", JSON.stringify(response.body, 1))
                            }
                        }
                    }
                    resolve(response)
                }
            )
        })
    }

    function message(chat_id, text, paramsJSON) {
        return extend({chat_id: chat_id}, {text: text}, paramsJSON)
    }

    function toPostbackPayload(goto, extra) {
        return JSON.stringify(Object.assign({
            goto: goto
        }, extra))
    }
    return result
}