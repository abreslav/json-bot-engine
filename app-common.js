'use strict'

const MongoClient = require('mongodb').MongoClient

const MongoStorage = require('./engine/mongo-storage')
const config = require('./app-config.json')

// start: (botEngine) => T
// stop: (T) => ()
module.exports.run = (start, stop) => {
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
}

module.exports.DONE = "Done"