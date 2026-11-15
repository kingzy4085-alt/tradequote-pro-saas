const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');

// Load Resend API key from environment
const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
    console.error("ERROR: RESEND_API_KEY is not set in your environment variables!");
    process.exit(1);
}

const resend = new Resend(apiKey);
const senderEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev'; // Replace with your verified domain email

async function runOutreach() {
    console.log("=== STARTING AUTOMATED OUTREACH ENGINE ===");
    
    const csvPath = path.join(__dirname, '../leads.csv');
    if (!fs.existsSync(csvPath)) {
        console.error("leads.csv not found!");
        return;
    }

    const lines = fs.readFileSync(csvPath, 'utf8').split('\n').filter(Boolean);
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1);

    for (const row of rows) {
        const [shopName, contactName, email] = row.split(',').map(val => val ? val.trim() : '');
        if (!email) continue;

        console.log(`Sending automated pitch to ${contactName} at ${shopName} (${email})...`);

        try {
            const { data, error } = await resend.emails.send({
                from: senderEmail,
                to: [email],
                subject: `Quick question about estimating at ${shopName}`,
                html: `
                    <p>Hi ${contactName},</p>
                    <p>I know you're busy on the tools running ${shopName}, so I'll keep this short.</p>
                    <p>Most electrical contractors lose hours every week wrestling with manual takeoff math and bloated spreadsheets.</p>
                    <p>I built <strong>TradeQuote PRO</strong> specifically to automate electrical estimates, material markups, and job costing in seconds instead of hours.</p>
                    <p>You can check it out and test it here: <a href="https://tradequotepro.com">tradequotepro.com</a></p>
                    <p>Best,<br>Kyle Ingalls<br>Ingzys Automation</p>
                `
            });

            if (error) {
                console.error(`Failed to send to ${email}:`, error);
            } else {
                console.log(`Successfully sent! Message ID: ${data.id}`);
            }
        } catch (err) {
            console.error(`Error sending to ${email}:`, err.message);
        }

        // Wait 2 seconds between emails to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log("=== OUTREACH BATCH COMPLETE ===");
}

runOutreach();
