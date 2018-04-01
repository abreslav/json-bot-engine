'use strict'

module.exports = (mailer) => {
    return {
        sendEmail: async (emailTo, subject, body) => {
            console.log("Sending email to " + emailTo.join())
            try {
                let r = await mailer.sendEmail(emailTo, subject, body)
                if (r.error) {
                    console.error(r.error)
                } else {
                    console.log("Email sent: " + JSON.stringify(r.info))
                    return true
                }
            } catch (e) {
                console.error(e)
            }
        }
    }
}