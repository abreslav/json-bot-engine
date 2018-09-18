'use strict'

const request = require('request')
const extend = require('extend')

const {PredefinedBlocks, PredefinedVariables} = require("./bot-engine")

module.exports = (config) => {
    const GALLERY_CALLBACK_PREFIX = "g"
    let result = {}
    result.testOnly = {}

    result.installWebhook = function (app, path, engine, appContext) {
        appContext.logger.log("App context:", appContext)
        appContext.scheduler.registerMessenger(
            TelegramApi.messenger,
            async (userId, payload) => {
                await engine.runScheduledTask(createContext(userId), payload)
            }
        )

        telegramSetWebhook()

        app.get(path, function (req, res) {
            console.log('GET request accepted from Telegram to path : ' + path)
            handleRequest(req, engine)
                .then(() => {
                    console.log("Sending 200 response code for GET request from Telegram.")
                    res.sendStatus(200)
                })
        })

        app.post(path, function (req, res) {
            console.log('POST request accepted from Telegram to path : ' + path)
            handleRequest(req, engine)
                .then(() => {
                    console.log("Sending 200 response code for POST request from Telegram.")
                    res.sendStatus(200)
                })
        })

        engine.initEngine(TelegramApi)

        // Set up the "Get Started" button
    }

    function createContext(chat_id) {
        return {
            sender: new TelegramSender(chat_id),
            messengerApi: TelegramApi,
            user_id: chat_id,
            messageBuilder: MessageBuilder
        }
    }

    function isGalleryCallback(callbackData) {
        return callbackData.startsWith(GALLERY_CALLBACK_PREFIX)
    }

    async function asyncSendPhoto(itemIds, itemIndex, engine, c) {
        const ec = await engine.getEc(c)
        const lastMessageId = ec.getTopStackFrame().message_id
        if (lastMessageId) {
            await c.sender.deleteMessage(lastMessageId)
        }
        let item = await getGalleryItem(itemIndex, ec)
        const items = await getGalleryItems(ec)
        const load = await getLoadForPhoto(items, item)
        const message = await ec.c.sender.sendPhoto(load)
        await ec.putOnStackAndSave({message_id: message.body.result.message_id})
    }

    async function handleGalleryCallback(engine, c, callbackData) {
        const tokens = callbackData.split("/")
        const itemId = tokens[0].substring(1, 2)
        let itemIds = tokens.splice(1, 6)
        return await asyncSendPhoto(itemIds, itemId, engine, c)
    }

    async function handleRequest(req, engine, context = createContext) {
        const {message} = req.body
        const {callback_query} = req.body
        let c
        if (message) {
            c = context(message.chat.id)
        } else if (callback_query) {
            c = context(callback_query.from.id)
            let callbackData = callback_query.data
            if (isGalleryCallback(callbackData)) {
                await engine.getEc(c);
                await handleGalleryCallback(engine, c, callbackData)
            } else {
                const payload = callback_query.data
                await engine.buttonPressed(c, payload)
            }
        }
        if (message && message.text) {
            let text = message.text
            await engine.textMessageReceived(c, text)
        } else if (message && !message.text) {
            console.log("Unrecoginzed message received: ", message)
        }
    }

    result.testOnly.handleRequest = handleRequest
    const TelegramApi = {
        messenger: "telegram",
        processInitInstruction: (instr, callback) => {

        }
    }
    const TelegramSender = function (chat_id) {
        this.sendMessage = async function (load) {
            let json = {}
            extend(json, load, {chat_id: chat_id})
            await telegramPost(config.telegram.bot_token + "/sendMessage", json)
        }
        this.sendPhoto = async function (load) {
            let json = {}
            extend(json, load, {chat_id: chat_id})
            return await telegramPost(config.telegram.bot_token + "/sendPhoto", json)
        }
        this.deleteMessage = async function (id) {
            // refactor
            let json = {}
            extend(json, {message_id: id}, {chat_id: chat_id})
            // move prefix to telegramPost
            await telegramPost(config.telegram.bot_token + "/deleteMessage", json)
        }
        this.fetchUserVariables = async () => {
            let json = {}
            extend(json, {chat_id: chat_id}, {user_id: chat_id})
            let response = await telegramPost(
                config.telegram.bot_token +
                "/getChatMember", json
            )
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

    function getLoadForPhoto(items, item) {
        return {
            photo: item.image_url,
            caption: item.title + "\n" + item.subtitle,
            reply_markup: getGalleryKeyboard(items, item)
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
                reply_markup: replyKeybordFromButtons(buttons)
            }
        },
        gallery: (items, ratio, ec) => {
            ec.c.sender.sendPhoto(getLoadForPhoto(items, items[0])).then(message => {
                    ec.putOnStackAndSave({message_id: message.body.result.message_id})
                }
            )
        }
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

    function getLeftButton(currentIndex, callbackData) {
        return {
            text: "<<",
            callback_data: callbackData
        }
    }

    function getRightButton(currentIndex, items, callbackData) {
        return {
            text: ">>",
            callback_data: callbackData
        }
    }

    function getGalleryKeyboard(items, currentItem) {
        const length = items.length
        const lastItemIndex = length - 1
        let leftItemIndex
        let rightItemIndex
        for (let i = 0; i < length; i++) {
            if (JSON.stringify(items[i]) === JSON.stringify(currentItem) ) {
                leftItemIndex = i > 0 ? i - 1 : lastItemIndex
                rightItemIndex = i < length - 1 ? i + 1 : 0
            }
        }
        return {
            inline_keyboard: [
                [getInlineButton(currentItem.buttons[0])],
                [
                    getLeftButton(currentItem.id, getCallbackDataForGalleryButton(items, leftItemIndex)),
                    getInlineButton(currentItem.buttons[1]),
                    getRightButton(currentItem.id, items, getCallbackDataForGalleryButton(items, rightItemIndex))
                ]
            ]
        }
    }

    function getCallbackDataForGalleryButton(items, buttonItemIndex) {
        let result = GALLERY_CALLBACK_PREFIX + buttonItemIndex + "/"
        for (let item of items) {
            result = result.concat(item.id).concat("/")
        }
        result = result.substring(0, result.length - 1)
        return result
    }

    function getInlineButton(itemButton) {
        if (itemButton.goto)
            return {
                text: itemButton.title,
                callback_data: "{ goto: " + itemButton.goto + " }"
            }
        else if (itemButton.web_url)
            return {
                text: itemButton.title,
                url: itemButton.web_url
            }
        else
            throw "Unsupported gallery button!"
    }

    async function telegramPost(url, json) {
        let jsonRequest = {
            url: "https://api.telegram.org/bot" + url,
            method: 'POST',
            json: json
        }
        return await telegramRequest(jsonRequest)
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

    async function telegramSetWebhook() {
        let json = {}
        extend(json, {url: config.telegram.webhook_host + config.telegram.webhook_path})
        await telegramPost(config.telegram.bot_token + "/setWebhook", json)
    }

    function message(chat_id, text, paramsJSON) {
        return extend({chat_id: chat_id}, {text: text}, paramsJSON)
    }

    async function getGalleryItems(ec) {
        let topStackFrame = ec.getTopStackFrame()
        if (topStackFrame.gallery) {
            return topStackFrame.gallery
        }
        return null
    }

    async function getGalleryItem(index, ec) {
        let topStackFrame = ec.getTopStackFrame()
        if (topStackFrame.gallery) {
            const item = topStackFrame.gallery[index]
            return ec.substituteObject(item)
        }
        return null
    }

    return result
}