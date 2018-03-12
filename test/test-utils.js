'use strict'

const assert = require('assert')

function jsonDiff(a, b, path = []) {
    function error(x, y, p = path) {
        return JSON.stringify(x) + " !== " + JSON.stringify(y) + " at " + p
    }

    switch (typeof a) {
        case  'string':
        case  'number':
        case  'boolean':
        case  'symbol':
            if (a !== b) return error(a, b)
            break;
        case 'object':
            if (!a || b === null) {
                if (a !== b) {
                    return error(a, b)
                }
            } else if (Array.isArray(a)) {
                if (!Array.isArray(b)) return error(a, b)
                if (a.length !== b.length) return error(a, b, path + ":length")
                for (let i = 0; i < a.length; i++) {
                    let diff = jsonDiff(a[i], b[i], path + `[${i}]`)
                    if (diff !== "OK") return diff
                }
            } else {
                let akeys = new Set(Object.keys(a))
                let bkeys = new Set(Object.keys(b))
                for (let ak of akeys) {
                    if (!bkeys.has(ak)) {
                        return "Missing key " + path + ":" + JSON.stringify(ak) + " in b (rhs)"
                    } else {
                        let diff = jsonDiff(a[ak], b[ak], path + ":" + JSON.stringify(ak))
                        if (diff !== "OK") return diff
                    }
                }
                for (let bk of bkeys) {
                    if (!akeys.has(bk)) {
                        return "Extra key " + path + ":" + JSON.stringify(bk) + "in b (rhs)"
                    }
                }
            }
            break;
        default:
            return "Unsupported " + JSON.stringify(a) + " at " + path
    }
    return "OK"
}

function compareJson(testName, actual, expected) {
    let diff = jsonDiff(actual, expected)
    if (diff !== "OK") {
        throw new Error(
            `Test ${testName} failed:\n` +
            "  " + diff + ":\n" +
            `Actual:\n ${JSON.stringify(actual, null, 1)}\n` +
            "        !=\n" +
            `Expected:\n ${JSON.stringify(expected, null, 1)}`
        )
    }
    // assert.deepEqual(
    //     actual,
    //     expected
    //     ,
    //     `Test ${testName} failed:\n` +
    //     `    ${JSON.stringify(actual, 1)}\n` +
    //     "        !=\n" +
    //     `    ${JSON.stringify(expected, 1)}`
    // )
}

function sanitizeEvent(event) {
    delete event.user_id
    delete event._id
    delete event.timestamp
    if (!event.unique) {
        delete event.unique
    }
}

function sanitizeEventLog(log) {
    for (let event of log) {
        sanitizeEvent(event)
    }
    return log
}

module.exports = {
    sanitizeEventLog: sanitizeEventLog,
    sanitizeEvent: sanitizeEvent,
    compareJson: compareJson
}