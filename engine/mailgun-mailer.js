'use strict'

const mailgun = require('mailgun-js')

module.exports = (config) => {
    return {
        sendEmail: async (emailTo, subject, body) => {
            return await new Promise((resolve) => {
                mailgun({
                    apiKey: config.mailer.mailgun.key,
                    domain: config.mailer.mailgun.domain
                }).messages().send(
                    {
                        from: `${config.mailer.from_name} <${config.mailer.mailgun.from}>`,
                        to: emailTo.join(", "),
                        subject: subject,
                        text: body
                    },
                    (error, body) => {
                        resolve({
                            info: body,
                            error: error
                        })
                    }
                )
            })
        }
    }
}