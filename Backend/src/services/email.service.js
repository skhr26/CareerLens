const nodemailer = require("nodemailer");

/**
 * Creates nodemailer transporter dynamically based on environment configuration.
 * Supports Gmail / custom SMTP or falls back to an Ethereal test transport with live preview URLs.
 */
async function createTransporter() {
    // Check if user configured explicit SMTP credentials in .env
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (emailUser && emailPass) {
        // Gmail / Custom SMTP service transport
        return nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE || "gmail",
            auth: {
                user: emailUser,
                pass: emailPass
            }
        });
    }

    // Check generic SMTP host/port
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (smtpHost && smtpUser && smtpPass) {
        return nodemailer.createTransport({
            host: smtpHost,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === "true",
            auth: {
                user: smtpUser,
                pass: smtpPass
            }
        });
    }

    // Fallback: Automatic test transport via Ethereal (Zero config required)
    console.log("[Email Service] No EMAIL_USER / EMAIL_PASS found in .env. Creating instant Ethereal test account...");
    const testAccount = await nodemailer.createTestAccount();

    return nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
            user: testAccount.user,
            pass: testAccount.pass
        }
    });
}

/**
 * Sends real email to target recipient using Nodemailer.
 *
 * `attachments` uses nodemailer's own shape: `[{ filename, content: Buffer, contentType }]`.
 * Without it a founder received a pitch with nothing to review, which is the whole point
 * of the message.
 */
async function sendRealEmail({ toEmail, subject, body, attachments = [] }) {
    if (!toEmail || !toEmail.trim()) {
        throw new Error("Recipient email address is required.");
    }

    const transporter = await createTransporter();

    const fromAddress = process.env.EMAIL_USER || process.env.SMTP_USER || '"CareerLens AI" <no-reply@careerlens.ai>';

    const safeBody = String(body || "");

    const mailOptions = {
        from: fromAddress,
        to: toEmail,
        subject: subject || "Job Application",
        text: safeBody,
        html: `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            ${safeBody.replace(/\n/g, "<br/>")}
        </div>`,
        // Omitted entirely when empty — some SMTP transports treat an empty array as a
        // malformed multipart body.
        ...(attachments.length ? { attachments } : {})
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(
        `[Email Service] Email sent successfully to ${toEmail}. Message ID: ${info.messageId}` +
        (attachments.length ? ` (${attachments.length} attachment: ${attachments.map(file => file.filename).join(", ")})` : "")
    );

    // If Ethereal test account was used, generate preview link
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
        console.log(`[Email Service] Preview live sent email at: ${previewUrl}`);
    }

    return {
        messageId: info.messageId,
        previewUrl: previewUrl || null
    };
}

module.exports = {
    sendRealEmail
};
