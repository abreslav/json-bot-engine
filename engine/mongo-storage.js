'use strict'

const assert = require('assert')
const {ObjectID, MongoClient} = require('mongodb')

module.exports = (config) => {
    return {
        // start: (storage) => T
        // stop: () => ()
        connect: (start, stop) => {
            MongoClient.connect(config.mongodb.url, function (err, mongoClient) {
                if (err) throw err;
                console.log("MongoClient connected correctly to ", config.mongodb.url.replace(/^(mongodb:\/\/[^:]+:)([^@]*)@/, "$1***@"))

                let storage = new MongoStorage(mongoClient.db(config.mongodb.db));

                let startedPromise = start(storage)

                function shutdown() {
                    // http://glynnbird.tumblr.com/post/54739664725/graceful-server-shutdown-with-nodejs-and-express
                    mongoClient.close()
                    if (stop) stop()
                    console.log("Killed")
                }

                process.on('SIGTERM', shutdown);
                process.on('SIGINT', shutdown);

                function closeClient() {
                    mongoClient.close()
                    console.log("MongoDB connection closed")
                }

                startedPromise
                    .then(closeClient)
                    .catch((err) => {
                        console.error(err)
                        closeClient()
                    })
            })
        },
        DONE: "Done"
    }
}

function MongoStorage(db) {
    const Collections = {
        USERS: "users",
        MESSAGE_LOG: "message_log",
        EVENT_LOG: "event_log",
        SCHEDULED_TASKS: "scheduled_tasks",
    }

    // callback: (userData, newUser)
    function createUser(id, messenger, callback) {
        db.collection(Collections.USERS).insertOne(
            {
                _id: id,
                messenger: messenger,
                stack: [],
                variables: {},
                user_input_handlers: [] // ????
            },
            null,
            (err, result) => {
                if (err) throw err
                assert(result.insertedCount === 1, `Something's wrong: result`)
                callback(result.ops[0], true)
            }
        )
    }

    this.createIndex = () => {
        db.collection(Collections.USERS).createIndex({_id: 1, messenger: 1}, {unique: true})
        db.collection(Collections.EVENT_LOG).createIndex({_id: 1, action: 1}, {unique: false})
    }

    // callback: (userData, newUser)
    this.getUserDataById = (c, callback) => {
        const userId = c.userId;
        const messenger = c.messengerApi.messenger;
        db.collection(Collections.USERS).find(
            {
                _id: userId,
                messenger: messenger
            }
        ).toArray(
            (err, result) => {
                if (err) throw err
                if (result.length === 1) {
                    let userData = result[0];
                    userData.variables = escapeNames(userData.variables)
                    Object.assign(userData, {action: 'get user', id: userData._id})
                    delete userData._id
                    this.logEvent(userData)
                        .then(callback(userData, false))
                } else if (result.length === 0) {
                    createUser(userId, messenger, callback)
                } else {
                    throw new Error("Many documents by the same ID: " + userId + ": " + result.join(", "))
                }
            }
        )
    }

    this.saveUserData = (userData, stack, variables, globalInputHandlers, callback) => {
        db.collection(Collections.USERS).updateOne(
            {
                _id: userData.id,
                messenger: userData.messenger
            },
            {
                $set: {
                    stack: stack,
                    variables: unescapeNames(variables),
                    user_input_handlers: globalInputHandlers
                }
            },
            undefined,
            (err, res) => {
                if (err) throw err
                console.log(JSON.stringify(userData) + " updated")
            }
        )
        this.logEvent({
            action: 'save user',
            id: userData.id,
            messenger: userData.messenger,
            stack: stack,
            variables: unescapeNames(variables),
            user_input_handlers: globalInputHandlers
        })
        console.log("Saving of " + JSON.stringify(userData) + " finished.")
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
            {user_id: userId}
        ).sort({_id: 1}).toArray()
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