const request = require('request')

module.exports = {
    doRequest: (jsonRequest, config) => {
        return new Promise(resolve => {
            request(
                jsonRequest,
                function (error, response) {
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
}