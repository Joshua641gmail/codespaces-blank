const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { auth, drive } = require('@googleapis/drive');
const cron = require('node-cron');
const fs = require('fs');
require('dotenv').config();

console.log('🔄 Initializing Production Background Engine on Railway...');

if (process.env.GOOGLE_CREDS_JSON) {
    try {
        fs.writeFileSync('./google-credentials.json', process.env.GOOGLE_CREDS_JSON);
        console.log('🔑 Google Drive credentials file written successfully!');
    } catch (err) {
        console.error('❌ Failed to write credentials file:', err);
    }
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true,
        executablePath: '/usr/bin/chromium-browser',
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ] 
    }
});

client.on('qr', (qr) => {
    console.clear();
    qrcode.generate(qr, { small: true });
    console.log('\n👉 RAILWAY LOGS: Scan this QR Code to link your account. 👈\n');
});

client.on('ready', () => {
    console.log('\n🚀 AUTOMATION ENGINE IS LIVE AND RUNNING ON RAILWAY!');
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

        const targetFile = files;
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

    // Night Post: Changed to 10:00 PM daily (22 represents 10pm)
    cron.schedule('0 22 * * *', () => sendDailyImage('Night'));
    
    console.log('📅 Timers armed: Morning (8:00 AM) and Night (10:00 PM) daily.');
}

client.initialize();
