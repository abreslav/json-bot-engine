'use strict'

module.exports = normalize

function normalize(text) {
    return text.toLowerCase().replace(/[\s.,`~!@#$%^&*()\-=+\[\]{}\\|:;'"<>?]/g, " ").replace(/\s+/g, " ").trim()
}