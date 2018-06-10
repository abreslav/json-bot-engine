'use strict'

const arrayShuffle = require("array-shuffle")
const normalize = require('./normalize')
const { toPromise } = require('./promise-utils')
const deepcopy = require('deepcopy')

const PredefinedBlocks = {
    INITIALIZE: "__initialize",
    ON_START: "__on_start",
    ON_UNRECOGNIZED: "__on_unrecognized",
}

const PredefinedVariables = {
    server_base_url: "${server_base_url}",
    user_first_name: "${user_first_name}",
    user_last_name: "${user_last_name}",
    messenger_user_id: "${messenger_user_id}",
    last_button: "${last_button}",
    last_block: "${last_block}",
    current_block: "${current_block}",
    last_user_message: "${last_user_message}",
    last_operator_message: "${last_operator_message}",
    locale: "${locale}",
    user_pic_url: "${user_pic_url}",
    url_ref_tag: "${url_ref_tag}",
    timezone: "${timezone}",
    timestamp: "${timestamp}",
    username: "${username}",
    messenger: "${messenger}"
}

const BotStates = {
    INITIAL: "new frame",
    EXECUTING: "executing instruction",
    GOTO: "goto",
    WAIT_FOR_REPLY: "wait for reply"
}

// the BotEngine class

// AppContext appContext: {storage, logger, pluginManager}
// EngineContext c: { userId, sender, messengerApi, messageBuilder, mailer }
// Execution context ec: { c, stack, variables, onMessageSent, resolver }
/*
userData = {
  _id: 1232341234123,
  stack: [
    {
        block_id: "A",
        ip: 2,
        state: "don't wait"
    },
    {
        block_id: "B",
        ip: 3,
        state: "don't wait"
    },
    {
        block_id: "Block Foo",
        ip: 3,
        state: "wait for reply",
        user_input_handlers: [
            {
                "user_input": ["привет", "hi", "hello", "start"],
                "goto": "Обработчик Привет"
            },
        ]
    },
  ],
  variables: [
    "${fooo}": "bar"
  ]
}
 */

function error(error) {
    throw new Error(error)
}

let BotEngine = function(blocks, appContext) {
    this.initEngine = async (messengerApi) => {
        let initBlock = blocks[PredefinedBlocks.INITIALIZE]
        if (initBlock) {
            for (let instr of initBlock) {
                if (messengerApi.messenger === instr.messenger) {
                    await toPromise((c) => messengerApi.processInitInstruction(instr, c))
                }
            }
        }
    }

    this.buttonPressed = async (c, payload) => {
        await logMessageReceived(c, {
            event_source: "button",
            payload: payload
        });
        let ec = await fetchUserContext(c)
        if (payload.goto) {
            await ec.doGoto(payload.goto)
        }
    }

    this.quickReplyChosen = async (c, payload) => {
        await logMessageReceived(c, {
            event_source: "quick_reply",
            payload: payload
        })
        let ec = await fetchUserContext(c)
        if (payload.goto) {
            await ec.doGoto(payload.goto)
        }
    }

    this.textMessageReceived = async (c, text) => {
        await logMessageReceived(c, {
            event_source: "text",
            text: text
        })
        let ec = await fetchUserContext(c)
        await ec.handleTextInput(text)
    }

    this.operatorMessageReceived = async (c, text) => {
        await logMessageReceived(c, {
            event_source: "operator",
            text: text
        })
        let ec = await fetchUserContext(c)
        await ec.handleOperatorInput(text)
    }

    this.runScheduledTask = async (c, payload) => {
        await logMessageReceived(c, {
            event_source: "scheduled_task",
            payload: payload
        })
        if (payload.goto) {
            let ec = await fetchUserContext(c)
            await ec.doGoto(payload.goto)
        }
    }

    this.referralLinkFollowed = async (c, referralTag) => {
        await logMessageReceived(c, {
            event_source: "referral",
            payload: referralTag
        })
        let ec = await fetchUserContext(c)
        return await ec.handleReferral(referralTag)
    }

    async function logMessageReceived(c, message) {
        await appContext.storage.logMessageReceived(c.messengerApi.messenger, c.userId, message)
    }

    async function fetchUserContext(c) {
        return await new Promise((resolve) => {
            appContext.storage.getUserDataById(c, (userData, newUser) => {
                let ec = new ExecutionContext(c, userData, blocks, appContext)
                initUserContext(ec).then(() => resolve(ec))
            })
        })
    }

    async function initUserContext(ec) {
        let fetched = await ec.c.sender.fetchUserVariables()
        if (fetched) {
            Object.keys(fetched).forEach((v) => {
                ec.assignVariable(v, fetched[v])
            })
        }
        // TODO: support other features in __initialize
        let initBlock = blocks[PredefinedBlocks.INITIALIZE]
        if (initBlock) {
            for (let instr of initBlock) {
                if (instr.messenger) {
                    // skip, should be handled in initEngine()
                } else if (instr.operator_input) {
                    ec.addOperatorInputHandler(Object.assign({}, instr, {user_input: instr.operator_input}))
                } else if (instr.user_input) {
                    ec.addGlobalInputHandler(instr)
                } else if (instr.assign) {
                    ec.assignVariable(instr.assign, instr.value)
                } else if (instr.url_ref_tag) {
                    ec.addReferralHandler(instr)
                } else {
                    console.error(`Unsupported in ${PredefinedBlocks.INITIALIZE}: ${JSON.stringify(instr)}`)
                }
            }
        }
    }

    this.testOnly = {}
    this.testOnly.startWithBlock = async (c, goto) => {
        let ec = await fetchUserContext(c)
        await ec.doGoto(goto)
    }

    this.testOnly.substituteText = async (c, text) => {
        let ec = await fetchUserContext(c)
        return ec.testOnly.substituteText(text)
    }
};

module.exports = BotEngine
module.exports.debugDelay = false
module.exports.PredefinedBlocks = PredefinedBlocks
module.exports.PredefinedVariables = PredefinedVariables

function ExecutionContext(c, userData, blocks, appContext) {
    let stack = userData.stack || []
    let variables = userData.variables || {}
    let globalInputHandlers = []
    let operatorInputHandlers = []
    let referralHandlers = []

    this.c = c

    this.doGoto = async (blockId, noReturn = false) => {
        goto(blockId, noReturn)
        await run()
    }

    this.assignVariable = (name, value, byValue = true) => {
        variables[name] = byValue ? defensiveCopy(value) : value
    }

    this.addReferralHandler = (handler) => {
        referralHandlers.push(handler)
    }

    this.handleReferral = async (referralTag) => {
        this.assignVariable(PredefinedVariables.url_ref_tag, referralTag)
        if (referralTag) {
            referralTag = referralTag.toLowerCase()
            for (let handler of referralHandlers) {
                if (referralTag === handler.url_ref_tag) {
                    await ec.doGoto(handler.goto)
                    return true
                }
            }
        }
        await saveToDB()
        return false
    }

    this.addGlobalInputHandler = (handler) => {
        globalInputHandlers.push(handler)
    }

    this.addOperatorInputHandler = (handler) => {
        operatorInputHandlers.push(handler)
    }

    this.handleTextInput = async (text) => {
        this.assignVariable(PredefinedVariables.last_user_message, text)

        let localInputData = fetchTopFrameInputData()
        let normalizedText = normalize(text)
        await handleInput(text, localInputData)
        || await dispatchInput(normalizedText, localInputData.user_input_handlers)
        || await dispatchInput(normalizedText, globalInputHandlers)
        || await handleUnrecognizedInput(text)
        || await saveToDB()
    }

    this.handleOperatorInput = async (text) => {
        this.assignVariable(PredefinedVariables.last_operator_message, text)

        await dispatchInput(normalize(text), operatorInputHandlers)
    }

    let ec = this

    function fetchTopFrameInputData() {
        let topFrame = getTopFrame()
        if (topFrame) {
            let result = {
                user_input_handlers: topFrame.user_input_handlers,
                input: topFrame.input
            }
            delete topFrame.user_input_handlers
            delete topFrame.input
            return result
        }
        return {}
    }

    async function handleInput(text, inputData) {
        if (inputData.input) {
            ec.assignVariable(inputData.input, text)
            await run()
            return true
        }
        return false
    }

    async function dispatchInput(normalizedText, handlers) {
        for (let handler of handlers || []) {
            for (let expected of handler.user_input) {
                if (expected === normalizedText) {
                    await ec.doGoto(handler.goto)
                    return true
                }
            }
        }
    }

    async function handleUnrecognizedInput(text) {
        if (blocks[PredefinedBlocks.ON_UNRECOGNIZED]) {
            await ec.doGoto(PredefinedBlocks.ON_UNRECOGNIZED)
            return true
        }
    }

    async function saveToDB() {
        await toPromise((c) => appContext.storage.saveUserData(userData, stack, variables, globalInputHandlers, c))
    }

    function initFrame(blockId) {
        return {
            block_id: blockId,
            ip: 0,
            state: BotStates.INITIAL,
            user_input_handlers: []
        }
    }

    function getTopFrame() {
        if (stack.length <= 0) return null
        return stack[stack.length - 1]
    }

    function updateTopFrameState(fields) {
        let topFrame = getTopFrame()
        console.log('Frame: ' + JSON.stringify(topFrame))
        console.log('Fields: ' + JSON.stringify(fields))
        if (topFrame) {
            Object.assign(topFrame, fields)
        }
    }

    function goto(blockId, noReturn = false) {
        if (!noReturn) {
            let topFrame = getTopFrame()
            if (topFrame && topFrame.state === BotStates.WAIT_FOR_REPLY) {
                if (topFrame.expected_gotos) {
                    if (topFrame.expected_gotos.indexOf(blockId) < 0) {
                        // reset stack if jumping to something unexpected
                        noReturn = true
                    }
                } else if (topFrame.input) {
                    noReturn = true
                }
            }
        }
        updateTopFrameState({ state: BotStates.GOTO })
        let newFrame = initFrame(blockId)
        if (noReturn) {
            stack = [newFrame]
        } else {
            stack.push(newFrame)
        }
    }

    async function run() {
        while (true) {
            let frame = getTopFrame()
            if (!frame) break
            let block = blocks[frame.block_id]
            if (!block) {
                error(`Unresolved block id: ${frame.block_id}`)
            }

            if (block.dynamic && appContext.pluginManager) {
                block = await appContext.pluginManager.resolve(block)
            }

            if (frame.ip >= block.length) {
                stack.pop()
                continue
            }

            let instr = block[frame.ip]
            frame.ip++
            frame.state = BotStates.EXECUTING

            let result = await executeInstruction(ec, instr)
            if (result === InstructionResults.WAIT) break
        }
        await saveToDB()
    }

    const InstructionResults = {
        CONTINUE: "continue",
        WAIT: "wait"
    }

    async function executeInstruction(ec, instr) {
        let mb = ec.c.messageBuilder
        instr = substituteObject(instr)
        if (typeof instr.text !== 'undefined') {
            if (instr.buttons) {
                await sendMessageAndLog(mb.textWithButtons(instr.text, instr.buttons));
                updateTopFrameState({
                    state: BotStates.WAIT_FOR_REPLY,
                    expected_gotos: collectGotos(instr),
                    user_input_handlers: collectInputHandlers(instr)
                })
                if (instr.buttons.find((b) => b.user_input)) {
                    return InstructionResults.WAIT
                }
            } else if (instr.quick_replies) {
                await sendMessageAndLog(mb.textWithQuickReplies(instr.text, instr.quick_replies))
                updateTopFrameState({
                    state: BotStates.WAIT_FOR_REPLY,
                    expected_gotos: collectGotos(instr),
                    user_input_handlers: collectInputHandlers(instr)
                })
                return InstructionResults.WAIT
            } else {
                await sendMessageAndLog(mb.text(instr.text))
            }
        } else if (instr.input) {
            // here: write to the appropriate var?
            // TODO implement "input" here
            updateTopFrameState({
                state: BotStates.WAIT_FOR_REPLY,
                input: instr.input
            })
            return InstructionResults.WAIT
        } else if (instr.image_url) {
            await sendMessageAndLog(mb.image_url(instr.image_url))
        } else if (instr.typing) {
            await sendMessageAndLog(mb.typingOn())
            await new Promise(
                (resolve) => setTimeout(resolve, BotEngine.debugDelay ? 1 : instr.typing)
            )
        } else if (instr.gallery) {
            await sendMessageAndLog(
                mb.gallery(
                    getItems(instr.gallery),
                    instr.gallery.image_aspect_ratio
                )
            )
        } else if (instr.schedule) {
            await appContext.scheduler.schedule(
                ec.c.messengerApi.messenger,
                ec.c.userId,
                instr.schedule,
                instr.trigger || "no_trigger",
                { goto: instr.goto }
            )
        } else if (instr.goto) {
            goto(instr.goto, instr.no_return || false)
        } else if (instr.goto_random) {
            let arr = instr.goto_random
            let rand = arr[Math.floor(Math.random() * arr.length)]
            goto(rand)
        } else if (instr.assign) {
            ec.assignVariable(instr.assign, instr.value)
        } else if (instr.append) {
            if (instr.append in variables) {
                variables[instr.append].push(defensiveCopy(instr.value))
            } else {
                ec.assignVariable(instr.append, instr.value)
            }
        } else if (instr.email_to) {
            await c.mailer.sendEmail(instr.email_to, instr.subject, instr.body)
        } else if (instr.random) {
            if (instr.random > 0) {
                let shuffled = arrayShuffle(instr.options).slice(0, instr.random)
                for (let i = 0; i < shuffled.length; i++) {
                    let r = await executeInstruction(ec, shuffled[i])
                    if (r !== InstructionResults.CONTINUE) {
                        error("Only synchronous commands are supported in {random}: " + JSON.stringify(shuffled[i]))
                    }
                }
            }
        } else if (instr.conditional) {
            let _else
            for (let entry of instr.conditional) {
                if (entry["else"]) {
                    _else = entry
                } else if (entry["if"] && isTrue(entry["if"])) {
                    goto(entry.goto)
                    return InstructionResults.CONTINUE
                }
            }
            if (_else) {
                goto(_else.else[0].goto)
            }
        } else if (instr.event) {
            let event = {
                user_id: ec.c.userId,
                event_type: instr.event,
                current_block: getTopFrame().block_id
            }
            if (instr.data) event.data = instr.data
            if (instr.unique) event.unique = true
            if (instr.start_new_session) event.start_new_session = true
            appContext.logger.log("User Event", event)

            await appContext.storage.logEvent(event)
        } else {
            error("Unsupported: " + JSON.stringify(instr, null, 1))
        }
        return InstructionResults.CONTINUE
    }

    function isTrue(cond) {
        switch (cond.operation) {
            case "equals":
                return substituteText(cond.left) === substituteText(cond.right)
            case "not_equals":
                return substituteText(cond.left) !== substituteText(cond.right)
            case "contains":
                return substituteText(cond.left).indexOf(substituteText(cond.right)) >= 0
            case "not_contains":
                return substituteText(cond.left).indexOf(substituteText(cond.right)) < 0
            case "not_set":
                return !variables[cond.left]
            case "not":
                return !isTrue(cond.left)
            case "and":
                return isTrue(cond.left) && isTrue(cond.right)
            case "or":
                return isTrue(cond.left) || isTrue(cond.right)
        }
    }

    async function sendMessageAndLog(message) {
        await c.sender.sendMessage(message)
        await appContext.storage.logMessageSent(c.messengerApi.messenger, c.userId, message)
    }

    function substituteText(text) {
        return text.replace(/\${[^}]+}/g, (s) => variables[s] || "<no value>")
    }
    this.testOnly = {}
    this.testOnly.substituteText = substituteText

    function substituteObject(obj) {
        let res = deepcopy(obj)
        let substitutableFields = new Set([
            "text", "image_url", "web_url", "title", "subtitle", "value",
            "email_to", "subject", "body", "data",
            "log_file",
            "url",
            "headers",
            "content",
            "gallery", "refs", "random_selection",
            "buttons", "quick_replies"
        ])

        function recSubst(obj, all = false) {
            if (!obj) return
            for (let key of Object.keys(obj)) {
                if (all || substitutableFields.has(key)) {
                    let value = obj[key];
                    if (typeof value === 'string') {
                        obj[key] = substituteText(value)
                    } else if (value && value.deref) {
                        obj[key] = variables[value.deref]
                    } else recSubst(value, true)
                }
            }
        }

        recSubst(res)
        return res
    }

    function getItems(galleryItems) {
        let result = []

        for (let item of galleryItems) {
            if (item.refs) {
                for (let ref of item.refs) {
                    let resolvedItem = blocks[ref]
                    if (!resolvedItem) {
                        error("Unresolved gallery item: " + JSON.stringify(ref))
                    }
                    result.push(substituteObject(resolvedItem))
                }
            } else if (item.random_selection) {
                let shuffled = arrayShuffle(item.from)
                for (let i = 0; i < item.random_selection; i++) {
                    if (i < shuffled.length) {
                        result.push(shuffled[i])
                    }
                }
            } else {
                result.push(item)
            }
        }
        return result
    }

    function collectInputHandlers(textInstr) {
        let buttons = textInstr.buttons || textInstr.quick_replies || []
        return buttons.map((button) => {
            return {
                user_input: [normalize(button.title)],
                goto: button.goto
            }
        }).filter((v) => v)
    }

    function collectGotos(textInstr) {
        let buttons = textInstr.buttons || textInstr.quick_replies || []
        return buttons.map((button) => button.goto).filter((v) => v)
    }

    function defensiveCopy(value) {
        if (Array.isArray(value)) {
            return value.slice()
        } else if (value && typeof value === 'object') {
            return Object.assign({}, value)
        } else return value
    }
}