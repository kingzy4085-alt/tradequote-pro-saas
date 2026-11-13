import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

export async function sendSMSNotification({ to, message }: { to: string; message: string }) {
  if (!client || !twilioNumber) {
    console.warn('Twilio credentials not configured. SMS skipped.');
    return { success: false, error: 'Twilio not configured' };
  }

  try {
    const result = await client.messages.create({
      body: message,
      from: twilioNumber,
      to,
    });
    return { success: true, sid: result.sid };
  } catch (err: any) {
    console.error('Failed to send SMS:', err.message);
    return { success: false, error: err.message };
  }
}