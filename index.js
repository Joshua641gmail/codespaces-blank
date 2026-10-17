const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { auth, drive } = require('@googleapis/drive');
const cron = require('node-cron');
const path = require('node:path');
const qrcode = require('qrcode-terminal');
const { dateNameFor, selectDateImage } = require('./lib/image-selection');

const timezone = process.env.SCHEDULE_TIMEZONE || 'Africa/Nairobi';
const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
const groupIds = (process.env.WHATSAPP_GROUP_IDS || '')
    .split(',')
    .map((groupId) => groupId.trim())
    .filter(Boolean);
const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDS_JSON;
const sessionPath = process.env.WHATSAPP_AUTH_PATH || path.join(process.cwd(), '.wwebjs_auth');

if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID must be set.');
}
if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must contain the Google service-account JSON.');
}
if (groupIds.length === 0 || groupIds.some((groupId) => !groupId.endsWith('@g.us'))) {
    throw new Error('WHATSAPP_GROUP_IDS must be a comma-separated list of WhatsApp group IDs ending in @g.us.');
}

try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
} catch (error) {
    throw new Error(`SCHEDULE_TIMEZONE is not a valid IANA timezone: ${timezone}`, { cause: error });
}

let credentials;
try {
    credentials = JSON.parse(serviceAccountJson);
} catch (error) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.', { cause: error });
}

const googleAuth = new auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const driveClient = drive({ version: 'v3', auth: googleAuth });

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionPath }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    },
});
let schedulesStarted = false;

client.on('qr', (qr) => {
    console.log('Scan this QR code from the WhatsApp account that is authorized to post in the selected groups:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log(`WhatsApp connected. Daily posts scheduled for 8:00 and 22:00 (${timezone}).`);
    setupSchedules();
});

client.on('auth_failure', (message) => {
    console.error('WhatsApp authentication failed:', message);
});

client.on('disconnected', (reason) => {
    console.error('WhatsApp disconnected:', reason);
});

client.on('message', async (message) => {
    if (!/^(?:!getid|getid!)$/i.test(message.body.trim())) {
        return;
    }

    try {
        await message.reply(`Group ID: ${message.from}`);
    } catch (error) {
        console.error('Failed to reply with the WhatsApp chat ID:', error);
    }
});

async function listImagesInFolder() {
    const files = [];
    let pageToken;

    do {
        const response = await driveClient.files.list({
            q: `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false and mimeType contains 'image/'`,
            orderBy: 'name',
            pageSize: 1000,
            pageToken,
            fields: 'nextPageToken,files(id,name,mimeType)',
        });

        files.push(...(response.data.files || []));
        pageToken = response.data.nextPageToken;
    } while (pageToken);

    return files;
}

async function sendDailyImage(slot) {
    const imageName = dateNameFor(new Date(), timezone);
    const image = selectDateImage(await listImagesInFolder(), imageName);
    const response = await driveClient.files.get(
        { fileId: image.id, alt: 'media' },
        { responseType: 'arraybuffer' },
    );
    const media = new MessageMedia(
        image.mimeType,
        Buffer.from(response.data).toString('base64'),
        image.name,
    );

    for (const groupId of groupIds) {
        await client.sendMessage(groupId, media);
    }

    console.log(`Posted ${image.name} to ${groupIds.length} group(s) for the ${slot} slot.`);
}

function setupSchedules() {
    if (schedulesStarted) {
        return;
    }
    schedulesStarted = true;

    cron.schedule('0 8 * * *', () => sendScheduledImage('morning'), {
        timezone,
        noOverlap: true,
    });
    cron.schedule('0 22 * * *', () => sendScheduledImage('evening'), {
        timezone,
        noOverlap: true,
    });
}

async function sendScheduledImage(slot) {
    try {
        await sendDailyImage(slot);
    } catch (error) {
        console.error(`Failed to post the ${slot} image:`, error);
    }
}

client.initialize().catch((error) => {
    console.error('WhatsApp client initialization failed:', error);
    process.exitCode = 1;
});
