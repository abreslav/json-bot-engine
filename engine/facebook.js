'use strict'

const request = require('request')
const extend = require('extend')

const { PredefinedBlocks, PredefinedVariables } = require("./bot-engine")

module.exports = (config) => {
    let result = {}
    result.testOnly = {}

    result.installWebhook = function(app, path, webhookVerificationToken, engine, scheduler) {
        scheduler.registerMessenger(
            FBMessengerApi.messenger,
            async (userId, payload) => {
                await engine.runScheduledTask(createContext(userId, scheduler), payload)
            }
        )
        app.get(path, function (req, res) {
            if (req.query['hub.verify_token'] === webhookVerificationToken) {
                res.send(req.query['hub.challenge'])
            } else {
                res.send('Error, wrong token')
            }
        })

        app.post(path, function (req, res) {
            handleRequest(req, engine, scheduler)
                .then(() => res.sendStatus(200))
        })

        engine.initEngine(FBMessengerApi)

        // Set up the "Get Started" button
        sendMessengerProfileRequest(
            { "get_started": {
                    "payload": toPostbackPayload(PredefinedBlocks.ON_START, {get_started: true})
                }}
        )
    }
    function createContext(userId) {
        return {
            sender: new FBSender(userId),
            messengerApi: FBMessengerApi,
            userId: userId,
            messageBuilder: MessageBuilder
        }
    }

    async function handleRequest(req, engine, scheduler, context = createContext) {
        let messaging_events = req.body.entry[0].messaging
        for (let i = 0; i < messaging_events.length; i++) {
            let event = req.body.entry[0].messaging[i]
            if (event["policy-enforcement"]) {
                console.error("POLICY ENFORCEMENT MESSAGE: ", JSON.stringify(event, null, 2))
                let emailResult = await context().mailer.sendEmail(
                    [config.facebook.policy_enforcement_email],
                    "Alert: Policy enforcement message",
                    JSON.stringify(event, null, 2)
                )
                if (emailResult) {
                    console.error("Alert email sent to " + config.facebook.policy_enforcement_email)
                }
                continue
            }
            let operatorMessage = event.sender.id === config.facebook.page_id
            let c = context(operatorMessage ? event.recipient.id : event.sender.id, scheduler)
            if (event.message && event.message.is_echo) {
                if (config.facebook.log_echos) {
                    console.log("ECHO MESSAGE: " + JSON.stringify(event))
                }
                if (operatorMessage && event.message.text) {
                    await engine.operatorMessageReceived(c, event.message.text)
                }
            } else if (event.message && event.message.text) {
                let text = event.message.text

                if (event.message.quick_reply && event.message.quick_reply.payload) {
                    await engine.quickReplyChosen(c, parsePayload(event.message.quick_reply.payload))
                    continue
                }

                await engine.textMessageReceived(c, text)
            } else if (event.postback) {
                if (event.postback.payload) {
                    let payload = parsePayload(event.postback.payload)
                    let handled = false
                    if (event.postback.referral) {
                        handled = await engine.referralLinkFollowed(c, event.postback.referral.ref)
                    } else if (payload.get_started) {
                        await engine.referralLinkFollowed(c, undefined)
                    }
                    if (!handled) {
                        await engine.buttonPressed(c, payload)
                    }
                } else {
                    let text = JSON.stringify(event.postback)
                    console.log("Unrecoginzed postback received: ", text)
                }
            } else if (event.referral) {
                await engine.referralLinkFollowed(c, event.referral.ref)
            }
        }
    }
    result.testOnly.handleRequest = handleRequest

    function parsePayload(payloadString) {
        let payload = JSON.parse(payloadString)
        if (Array.isArray(payload.blocks)) {
            return { "goto": payload.blocks[0] }
        }
        return payload
    }

    const FBMessengerApi = {
        messenger: "facebook",
        processInitInstruction: (instr, callback) => {
            if (instr.greeting) {
                sendMessengerProfileRequest(
                    {"greeting": instr.greeting},
                    callback
                )
            } else {
                if (callback) callback()
            }
        }
    }

    const FBSender = function(userId) {
        this.sendMessage = async function (load) {
            let json = {}
            extend(json, load, {recipient: {id: userId}, messaging_type: "RESPONSE"})
            await fbPost('https://graph.facebook.com/v2.6/me/messages', json)
        }
        this.fetchUserVariables = async () => {
            let response = await fbGet(
                `https://graph.facebook.com/v2.6/${userId}`,
                {
                    "fields": "first_name,last_name,profile_pic,locale,timezone"
                }
            )
            if (response && !response.body.error) {
                let fetched = JSON.parse(response.body)
                let result = {}
                result[PredefinedVariables.server_base_url] = config.http.base_url
                result[PredefinedVariables.messenger_user_id] = fetched.id
                result[PredefinedVariables.user_first_name] = fetched.first_name
                result[PredefinedVariables.user_last_name] = fetched.last_name
                result[PredefinedVariables.user_pic_url] = fetched.profile_pic
                result[PredefinedVariables.locale] = fetched.locale
                result[PredefinedVariables.timezone] = fetched.timezone
                return result
            }
        }
    }

    const MessageBuilder = {
        text: (text) => {
            return message({text:text})
        },
        image_url: (image_url) => {
            console.log("TODO: images are not yet supported" + image_url)
            return message({text: "TODO: images are not yet supported: " + image_url})
        },
        textWithButtons: (text, buttons) => {
            return message({
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: text,
                        buttons: buttons.map(toFBButton)
                    }
                }
            })
        },
        textWithQuickReplies: (text, buttons) => {
            return message({
                text: text,
                quick_replies: buttons.map(toFBQuickReply)
            })
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
        },

        typingOn: () => { return senderAction(typing_on_str) },
        typingOff: () => { return senderAction(typing_off_str) },
        markSeen: () => { return senderAction(mark_seen_str) },
    }
    result.testOnly.MessageBuilder = MessageBuilder

    function sendMessengerProfileRequest(json, callback) {
        fbPost("https://graph.facebook.com/v2.6/me/messenger_profile", json, callback)
    }

    async function fbPost(url, json) {
        let jsonRequest = {
            url: url,
            qs: {access_token: config.facebook.page_access_token},
            method: 'POST',
            json: json
        };
        return await fbRequest(jsonRequest);
    }

    async function fbGet(url, params) {
        let jsonRequest = {
            url: url,
            qs: Object.assign(
                {access_token: config.facebook.page_access_token},
                params
            ),
            method: 'GET'
        };
        return await fbRequest(jsonRequest);
    }

    function fbRequest(jsonRequest) {
        return new Promise(resolve => {
            request(
                jsonRequest,
                function (error, response, body) {
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

    const typing_on_str = "typing_on"
    const typing_off_str = "typing_off"
    const mark_seen_str = "mark_seen"

    function senderAction(action) {
        return {sender_action: action};
    }

    function message(messageData) {
        return {message: messageData};
    }

    function toPostbackPayload(goto, extra) {
        return JSON.stringify(Object.assign({
            goto: goto
        }, extra))
    }

    function toFBButton(button) {
        function postbackButton(title, goto) {
            return {
                type: "postback",
                title: title,
                payload: toPostbackPayload(goto)
            }
        }

        function webUrlButton(title, url, heightRatio = "full") {
            return {
                type: "web_url",
                title: title,
                url: url,
                webview_height_ratio: heightRatio
            }
        }

        if (button.goto) {
            return postbackButton(button.title, button.goto)
        } else if (button.web_url) {
            return webUrlButton(button.title, button.web_url)
        }

        throw new Error("Button not supported: " + JSON.stringify(button))
    }

    function toFBQuickReply(button) {
        let result = {
            content_type: "text",
            title: button.title,
            payload: toPostbackPayload(button.goto)
        }
        if (button.image_url) {
            result.image_url = button.image_url
        }
        return result
    }

    function toFBGalleryElement(element) {
        return {
            title: element.title,
            subtitle: element.subtitle,
            image_url: element.image_url,
            buttons: element.buttons.map(toFBButton),
        }
    }

    return result
}