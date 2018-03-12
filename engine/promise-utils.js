'use strict'

module.exports = {
    // f: (callback) => void
    toPromise: (f) => {
        return new Promise((resolve, reject) => {
            try {
                f(resolve)
            } catch (e) {
                reject(e)
            }
        })
    },

    runWithCallback: (asyncF, callback) => {
        asyncF().then(() => {if (callback) callback()})
    }
}
