'use strict'

const RestClient = require('node-rest-client').Client

module.exports = (config) => class {
    constructor(storage) {
        this.storage = storage
        this.messengers = {}
    }

    install(app) {
        app.get('/scheduled-tasks/:id', (req, res) => {
            let id = req.params.id
            let trigger = req.query.trigger
            if (config.logging.log_http_requests) {
                console.log("SCHEDULER TASK: " + JSON.stringify(req.params) + JSON.stringify(req.query))
            }

            (async () => {
                let task = await this.storage.fetchScheduledTask(id)
                console.log("SCHEDULER: task retrieved: " + (task || "undefined"))
                if (task) {
                    if (task.trigger !== trigger) {
                        console.error("SCHEDULER: trigger does not match, expected " + trigger + " actual " + task.trigger)
                    } else {
                        let handler = this.messengers[task.messenger]
                        if (!handler) {
                            console.error("SCHEDULER: no handler for messenger " + task.messenger)
                        } else {
                            console.log("SCHEDULER: executing " + JSON.stringify(task.payload))
                            await handler(task.user_id, task.payload)
                        }
                    }
                }
            })().then(() => res.sendStatus(200))
        })
    }

    registerMessenger(messengerId, handler) {
        this.messengers[messengerId] = handler
    }

    async schedule(messenger, userId, timeSlice, triggerName, payload) {
        let id = await this.storage.recordScheduledTask(messenger, userId, timeSlice, triggerName, payload)
        if (!id) {
            console.log(`SCHEDULER: FAILED to schedule task: user_id=${userId}, ${timeSlice.wait} ${timeSlice.unit} ${triggerName} ${JSON.stringify(payload)}`)
        } else {
            let timeSliceStr = `${timeSlice.wait}${timeSlice.unit}`
            let callbackUrl = encodeURIComponent(`https://bot-server-for-psyalter.xyz/scheduled-tasks/${id}?trigger=${triggerName}`)
            let url = `https://api.atrigger.com/v1/tasks/create?key=${config.atrigger.key}&secret=${config.atrigger.secret}&timeSlice=${timeSliceStr}&count=1&url=${callbackUrl}&tag_trigged=${triggerName}`
            new RestClient().get(url, (data, res) => {
                if (res.statusCode !== 200 || data && data.type === "ERROR") {
                    console.error(JSON.stringify({
                        error: "Failed to schedule a task with ATrigger.com",
                        url: url,
                        httpStatusCode: res.statusCode,
                        httpStatusMessage: res.statusMessage,
                        jsonResponse: data
                    }, null, 1))
                } else {
                    console.log(`SCHEDULER: task ${id} scheduled successfully user_id=${userId}, ${timeSlice.wait} ${timeSlice.unit} ${triggerName} ${JSON.stringify(payload)}`)
                }
            })
        }
    }
}