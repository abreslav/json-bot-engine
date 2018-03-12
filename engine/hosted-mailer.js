'use strict'

const nodemailer = require('nodemailer')

module.exports = (config) => {
    return {
        sendEmail: async (emailTo, subject, body) => {
            const transporter = nodemailer.createTransport(config.mailer.local_mailer.transport)

            const mailOptions = {
                from: `${config.mailer.from_name} <${config.mailer.local_mailer.from}>`,
                to: emailTo.join(", "),
                subject: subject,
                text: body
            };

            return await new Promise((resolve) => {
                transporter.sendMail(mailOptions, function (error, info) {
                    resolve({
                        info: info.response,
                        error: error
                    })
                })
            })
        }
    }
}