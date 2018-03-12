'use strict'

const assert = require('assert')
const ObjectID = require('mongodb').ObjectID

module.exports = function (db) {
    const Collections = {
        USERS: "users",
        MESSAGE_LOG: "message_log",
        EVENT_LOG: "event_log",
        SCHEDULED_TASKS: "scheduled_tasks",
    }

    // callback: (userData, newUser)
    function createUser(id, callback) {
        db.collection(Collections.USERS).insertOne(
            {
                _id: id,
                stack: [],
                variables: {}
            },
            null,
            (err, result) => {
                if (err) throw err
                assert(result.insertedCount === 1, `Something's wrong: result`)
                callback(result.ops[0], true)
            }
        )
    }

    // callback: (userData, newUser)
    this.getUserDataById = (id, callback) => {
        db.collection(Collections.USERS).find(
            {_id: id}
        ).toArray(
            (err, result) => {
                if (err) throw err
                if (result.length === 1) {
                    let userData = result[0];
                    userData.variables = escapeNames(userData.variables)
                    callback(userData, false)
                } else if (result.length === 0) {
                    createUser(id, callback)
                } else {
                    throw new Error("Many documents by the same ID: " + id + ": " + result.join(", "))
                }
            }
        )
    }

    this.saveUserData = (id, stack, variables, globalInputHandlers, callback) => {
        db.collection(Collections.USERS).updateOne(
            { _id: id },
            {
                $set: {
                    stack: stack,
                    variables: unescapeNames(variables),
                    user_input_handlers: globalInputHandlers
                }
            },
            undefined,
            (err, result) => {
                if (err) throw err
                if (callback) {
                    callback()
                }
            }
        )
    }

    this.logMessageReceived = async (userDomain, userId, message) => {
        await logMessage(userDomain, userId, "received", message)
    }

    this.logMessageSent = async (userDomain, userId, message) => {
        await logMessage(userDomain, userId, "sent", message)
    }

    // direction: ("sent" | "received") meaning by the bot, to/from user
    async function logMessage(userDomain, userId, direction, message) {
        await db.collection(Collections.MESSAGE_LOG).insertOne(
            {
                user_domain: userDomain,
                user_id: userId,
                direction: direction,
                message: message
            }
        )
    }

    this.logEvent = async (event) => {
        return await db.collection(Collections.EVENT_LOG).insertOne(event)
    }

    this.processEvents = async (each) => {
        let collection = db.collection(Collections.EVENT_LOG)
        let cursor = await collection.find({}).sort({_id: 1})
        while (await cursor.hasNext()) {
            let e = await cursor.next()
            each(e)
        }
    }

    this.recordScheduledTask = async (messenger, userId, timeSlice, triggerName, payload) => {
        return (await db.collection(Collections.SCHEDULED_TASKS).insertOne({
            messenger: messenger,
            user_id: userId,
            time_slice: timeSlice,
            trigger: triggerName,
            payload: payload
        })).insertedId
    }

    this.fetchScheduledTask = async (id) => {
        return (await db.collection(Collections.SCHEDULED_TASKS).findOneAndDelete({_id: ObjectID(id)})).value
    }

    this.testOnly = {}
    this.testOnly.clearStorage = async () => {
        for (let key of Object.keys(Collections)) {
            await db.collection(Collections[key]).deleteMany({})
        }
    }

    this.testOnly.getMessageLog = async (userId) => {
        return await db.collection(Collections.MESSAGE_LOG).find(
            { user_id: userId }
        ).sort({ _id: 1 }).toArray()
    }
}

function escapeNames(unescaped) {
    let escaped = {}
    for (let key of Object.keys(unescaped)) {
        escaped["${" + key + "}"] = unescaped[key]
    }
    return escaped
}

function unescapeNames(escaped) {
    let unescaped = {}
    for (let key of Object.keys(escaped)) {
        let unescapedKey = key.replace(/^\${([^}]+)}$/, "$1")
        unescaped[unescapedKey] = escaped[key]
    }
    return unescaped
}