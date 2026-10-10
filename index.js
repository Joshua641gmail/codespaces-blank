const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { auth, drive } = require('@googleapis/drive');
const cron = require('node-cron');
require('dotenv').config();

console.log('🔄 Initializing Production Background Engine...');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    }
});

client.on('qr', (qr) => {
    console.clear();
    qrcode.generate(qr, { small: true });
    console.log('\n👉 RAILWAY LOGS: Scan this QR Code to log back in. 👈\n');
});

client.on('ready', () => {
    console.log('\n🚀 AUTOMATION ENGINE IS LIVE AND RUNNING ON RAILWAY!');
    console.log(`Active Groups: ${process.env.WHATSAPP_GROUP_IDS}`);
    setupSchedules();
});

const googleAuth = new auth.GoogleAuth({
    keyFile: './google-credentials.json',
    scopes: ['https://googleapis.com'],
});
const driveClient = drive({ version: 'v3', auth: googleAuth });

async function sendDailyImage(timeOfDay) {
    try {
        console.log(`\n[${new Date().toLocaleTimeString()}] 📦 Fetching image for: ${timeOfDay}`);
        
        const response = await driveClient.files.list({
            q: `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed = false`,
            orderBy: 'createdTime asc',
            pageSize: 5,
            fields: 'files(id, name, mimeType)',
        });

        const files = response.data.files;
        if (!files || files.length === 0) {
            console.log('⚠️ Alert: No images found in Google Drive folder.');
            return;
        }

        const targetFile = files[0];
        console.log(`📥 Downloading: ${targetFile.name}`);

        const fileMedia = await driveClient.files.get(
            { fileId: targetFile.id, alt: 'media' },
            { responseType: 'arraybuffer' }
        );
        
        const base64Data = Buffer.from(fileMedia.data).toString('base64');
        const media = new MessageMedia(targetFile.mimeType, base64Data, targetFile.name);

        const targetGroupIds = process.env.WHATSAPP_GROUP_IDS.split(',');
        for (const groupId of targetGroupIds) {
            await client.sendMessage(groupId.trim(), media, { 
                caption: `Daily Automated ${timeOfDay} Post` 
            });
        }
        console.log(`✅ Posted to groups successfully.`);

        await driveClient.files.update({ fileId: targetFile.id, requestBody: { trashed: true } });
        console.log(`🗑️ Moved ${targetFile.name} to trash.`);

    } catch (error) {
        console.error('❌ Automation Error:', error);
    }
}

function setupSchedules() {
    // Morning Post: 8:00 AM daily
    cron.schedule('0 8 * * *', () => sendDailyImage('Morning'));

    // Night Post: 8:00 PM daily
    cron.schedule('0 20 * * *', () => sendDailyImage('Night'));
    
    console.log('📅 Timers armed: 8:00 AM and 8:00 PM daily.');
}

client.initialize();
