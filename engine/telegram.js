'use strict'

const extend = require('extend')

const {PredefinedBlocks, PredefinedVariables} = require("./bot-engine")
const requestUtils = require('./request-handling-utils')

module.exports = (config) => {
    let result = {}
    result.testOnly = {}

    result.installWebhook = function (app, host, path, engine, appContext) {
        appContext.scheduler.registerMessenger(
            TelegramApi.messenger,
            async (userId, payload) => {
                await engine.runScheduledTask(createContext(userId), payload)
            }
        )

        let webhookResponse = telegramSetWebhook()

        app.post(path, function (req, res) {
            handleRequest(req, engine)
                .then(() => res.sendStatus(200))
        })

        app.get(path, function (req, res) {
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
        let c
        if (message) {
            c = context(message.chat.id)
        } else if (callback_query) {
            c = context(callback_query.from.id)
        }
        if (message && message.text) {
            console.log('Message received: ' + message.text);
            let text = message.text
            await engine.textMessageReceived(c, text)
        } else if (callback_query) {
            console.log('Callback query received: ' + callback_query);
            const payload = parsePayload(callback_query)
            await engine.buttonPressed(c, payload)
        } else if (message && !message.text) {
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
        this.sendMessage = async function (pic_url, text) {
            let json = {
                chat_id: chat_id,
                photo: pic_url,
                caption: text,
                reply_markup: [[{text: "Подробнее"}],
                    [{text: "<"}, {text: "Контакты"}, {text: ">"}]]
            }
            await telegramPost("https://api.telegram.org/bot" + config.telegram.bot_token + "/sendMessage", json)
        }
        this.sendphoto = async function (load) {
            let json = {}
            extend(json, load, {chat_id: chat_id})
            await telegramPost("https://api.telegram.org/bot" + config.telegram.bot_token + "/sendPhoto", json)
        }
        this.fetchUserVariables = async () => {
            let json = {}
            extend(json, {chat_id: chat_id}, {user_id: chat_id})
            let response = await telegramPost(
                "https://api.telegram.org/bot" + config.telegram.bot_token + "/getChatMember", json)
            if (response && !response.body.error) {
                let fetched = response.body.result
                const user = fetched.user
                let result = {}
                result[PredefinedVariables.server_base_url] = config.http.base_url
                result[PredefinedVariables.messenger_user_id] = user.id
                result[PredefinedVariables.user_first_name] = user.first_name
                result[PredefinedVariables.user_last_name] = user.last_name
                result[PredefinedVariables.locale] = user.language_code
                result[PredefinedVariables.username] = user.username
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
                reply_markup: inlineKeyboardFromButtons(buttons)
            }
        },
        textWithQuickReplies: (text, buttons) => {
            return {
                text: text,
                reply_markup: replyKeyboardFromButtons(buttons)
            }
        },
        gallery: (items, image_aspect_ratio = "square") => {
            return message({
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "generic",
                        image_aspect_ratio: image_aspect_ratio || "square",
                        elements: items.map(toFBGalleryElement)
                    }
                }
            })
        }
    }
    result.testOnly.MessageBuilder = MessageBuilder

    function inlineKeyboardFromButtons(buttons) {
        return {
            inline_keyboard: [buttons.map(it => {
                return {
                    text: it["title"],
                    callback_data: it["goto"]
                }
            })]
        }
    }

    function replyKeyboardFromButtons(buttons) {
        return {
            keyboard: [buttons.map(it => {
                return {
                    text: it["title"]
                }
            })]
        }
    }

    async function telegramSetWebhook() {
        let json = {}
        extend(json, {url: config.telegram.webhook_host + config.telegram.webhook_path})
        await telegramPost("https://api.telegram.org/bot" + config.telegram.bot_token + "/setWebhook", json)
    }

    async function telegramPost(url, json) {
        let jsonRequest = {
            url: url,
            method: 'POST',
            json: json
        };
        return await requestUtils.doRequest(jsonRequest, config);
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