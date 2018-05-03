'use strict'

// npm modules
const express = require('express')
const bodyParser = require('body-parser')

// our modules
const config = require('./app-config.json')
const mongoStorage = require('../engine/mongo-storage')(config)
const BotEngine = require('../engine/bot-engine')
const mailer = require('../engine/mailgun-mailer')(config)
const Scheduler = require('../engine/scheduler')(config)
const LoggingMailer = require('../engine/logginig-mailer')
const tg = require('../engine/telegram')(config)

const app = express()

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: false}))
// Process application/json
app.use(bodyParser.json())
// Serve static files
app.use(express.static(config.http.public_html_dir))

// Log requests if configured
app.use((req, res, next) => {
    if (config.logging.log_http_requests) {
        console.log("content : " + JSON.stringify(req.body));
    }
    next()
})

// Index route
app.get('/', function (req, res) {
    res.send('Status: running')
})


let server = undefined
mongoStorage.connect(
    (storage) => {
        let botDefinition = require(config.bot.file);
        if (botDefinition) {
            console.log(`Successfully loaded JSON from ${config.bot.file}: ${Object.keys(botDefinition).length} blocks`)
        }

        let scheduler = new Scheduler(storage)
        let loggingMailer = LoggingMailer(mailer)
        let appContext = {
            storage: storage,
            logger: { log: (msg, json) => console.log(msg + ": " + JSON.stringify(json)) },
            scheduler: scheduler,
            mailer: loggingMailer
        }
        let botEngine = new BotEngine(botDefinition, appContext)

        scheduler.install(app)
        tg.installWebhook(app, config.telegram.webhook_host, config.telegram.webhook_path, botEngine, scheduler)

        // Spin up the server
        server = app.listen(config.http.port, function () {
            console.log('Express.js running on port', config.http.port)
        })
        return new Promise((resolve, reject) => {}) // never resolve
    },
    () => {
        if (server) server.close()
    }
)