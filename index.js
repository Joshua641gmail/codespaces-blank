const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    DisconnectReason,
    fetchLatestWaWebVersion,
    jidNormalizedUser,
    normalizeMessageContent,
    useMultiFileAuthState,
} = require('@whiskeysockets/baileys');
const { auth, drive } = require('@googleapis/drive');
const cron = require('node-cron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const pino = require('pino');
require('dotenv').config();
const { isWeekdayFor, selectWeekdayImage, weekdayNameFor } = require('./lib/image-selection');
const { localDateKeyFor, localSecondsFor, planDay } = require('./lib/post-schedule');
const { countdownDaysFor, countdownMessage, dateInTimeZone } = require('./lib/countdown-message');
const { captionFor, messageFor } = require('./lib/content');

const timezone = process.env.SCHEDULE_TIMEZONE || 'Africa/Nairobi';
const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
const groupIds = (process.env.WHATSAPP_GROUP_IDS || '')
    .split(',')
    .map((groupId) => groupId.trim())
    .filter(Boolean);
const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDS_JSON;
const sessionPath = process.env.WHATSAPP_AUTH_PATH || path.join(process.cwd(), '.baileys_auth');
const pairingPhoneNumber = process.env.WHATSAPP_PHONE_NUMBER?.trim();

if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID must be set.');
}
if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must contain the Google service-account JSON.');
}
if (!pairingPhoneNumber) {
    throw new Error('WHATSAPP_PHONE_NUMBER must be set to link WhatsApp by phone number.');
}
if (groupIds.some((groupId) => !groupId.endsWith('@g.us'))) {
    throw new Error('WHATSAPP_GROUP_IDS must contain WhatsApp group IDs ending in @g.us.');
}
if (!/^[1-9]\d{6,14}$/.test(pairingPhoneNumber)) {
    throw new Error('WHATSAPP_PHONE_NUMBER must use international format with digits only, including the country code.');
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

let schedulesStarted = false;
let whatsappStatus = 'starting';
let whatsappSocket;
let reconnectTimer;
let reconnectAttempts = 0;

const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000;
// A post that is more than this late (for example after a long outage) is skipped, not sent in a rush.
const MAX_LATE_SECONDS = 30 * 60;
const planPath = path.join(sessionPath, 'daily-plan.json');
const statePath = path.join(sessionPath, 'state.json');
const scheduledEntries = new Set();
// Commands older than this are ignored, so replayed chat history never pauses or resumes anything.
const COMMAND_MAX_AGE_SECONDS = 120;

// Pause state is saved to disk so it survives restarts and redeploys.
function loadPaused() {
    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8')).paused === true;
    } catch {
        return false;
    }
}

function savePaused(value) {
    try {
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify({ paused: value }));
    } catch (error) {
        console.error('Could not save the pause state:', error);
    }
}

let paused = loadPaused();
let lastResult = 'none yet';

// Log problems instead of letting one stray error crash the service (Railway shows a crash as a failed deploy).
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ status: 'ok', whatsapp: whatsappStatus, paused, lastResult }));
        return;
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
});

server.on('error', (error) => {
    console.error('HTTP health server failed:', error);
    process.exitCode = 1;
});
server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => {
    console.log(`Health endpoint listening on port ${server.address().port}.`);
});

function messageText(message) {
    const content = normalizeMessageContent(message.message);
    return (content?.conversation || content?.extendedTextMessage?.text || '').trim();
}

function ownChatIds(socket) {
    return [socket.user?.id, socket.user?.lid]
        .filter(Boolean)
        .map((id) => jidNormalizedUser(id));
}

function statusText() {
    const plan = loadPlan();
    const lines = [
        `Posting: ${paused ? 'PAUSED' : 'ACTIVE'}`,
        `WhatsApp: ${whatsappStatus}`,
        `Last result: ${lastResult}`,
    ];
    if (plan?.dateKey === localDateKeyFor(new Date(), timezone) && plan.entries.length > 0) {
        lines.push(`Today (${timezone}):`);
        for (const entry of plan.entries) {
            lines.push(`${formatSeconds(entry.atSecond)} ${entry.type} - ${entry.status}`);
        }
    } else {
        lines.push('No posts planned for the rest of today.');
    }
    return lines.join('\n');
}

// Commands: send !pause, !resume or !status to yourself ("Message yourself" chat).
// !getid works from the linked account inside a group.
async function handleCommand(socket, message) {
    if (!message.key.fromMe) {
        return;
    }
    const age = Date.now() / 1000 - Number(message.messageTimestamp || 0);
    if (age > COMMAND_MAX_AGE_SECONDS) {
        return;
    }

    const chatId = message.key.remoteJid;
    const body = messageText(message);

    try {
        if (chatId?.endsWith('@g.us') && /^(?:!getid|getid!)$/i.test(body)) {
            console.log('Received WhatsApp group-ID request.');
            await socket.sendMessage(chatId, { text: `Group ID: ${chatId}` });
            return;
        }

        if (!ownChatIds(socket).includes(jidNormalizedUser(chatId || ''))) {
            return;
        }
        const command = body.toLowerCase();
        if (command === '!pause') {
            paused = true;
            savePaused(true);
            console.log('Posting paused by command.');
            await socket.sendMessage(chatId, { text: 'Posting paused. Send !resume to continue.' });
        } else if (command === '!resume') {
            paused = false;
            savePaused(false);
            console.log('Posting resumed by command.');
            await socket.sendMessage(chatId, { text: 'Posting resumed.' });
        } else if (command === '!status') {
            await socket.sendMessage(chatId, { text: statusText() });
        }
    } catch (error) {
        console.error('Failed to handle a command:', error);
    }
}

// Back off between attempts (5s, 10s, 20s ... up to 5 minutes) instead of retrying at a fixed rate.
// Used for every failure, so a single failed start can never leave the service silently offline.
function scheduleReconnect(reason, detail) {
    const delay = Math.min(5000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    reconnectAttempts += 1;
    console.error(`${reason}; retrying in ${Math.round(delay / 1000)}s:`, detail);
    if (reconnectTimer) {
        return;
    }
    reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connectWhatsApp().catch((error) => {
            whatsappStatus = 'initialization_failed';
            scheduleReconnect('WhatsApp reconnection failed', error);
        });
    }, delay);
}

async function connectWhatsApp() {
    const { version, isLatest, error } = await fetchLatestWaWebVersion();
    if (!isLatest) {
        // Baileys hands back a built-in version when the lookup fails; try it rather than staying offline.
        console.warn('Could not fetch the current WhatsApp Web version; using the built-in one.', error?.message);
    }
    console.log(`Using WhatsApp Web version ${version.join('.')}.`);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const socket = makeWASocket({
        auth: state,
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        // Do not announce "online" on every connect; the phone keeps its own notifications.
        markOnlineOnConnect: false,
    });
    whatsappSocket = socket;
    let pairingCodeIssued = false;

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('messages.upsert', async ({ messages }) => {
        for (const message of messages) {
            await handleCommand(socket, message);
        }
    });
    socket.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            whatsappStatus = 'connected';
            reconnectAttempts = 0;
            console.log('WhatsApp client is ready.');
            if (groupIds.length === 0) {
                console.log('WhatsApp connected. Send !getid in each target group to retrieve its ID, then set WHATSAPP_GROUP_IDS and redeploy.');
            } else {
                console.log(`WhatsApp connected. Daily randomized post plan active (${timezone}).`);
                setupSchedules();
            }
            return;
        }

        if (connection === 'connecting') {
            whatsappStatus = state.creds.registered
                ? 'connecting'
                : pairingCodeIssued
                    ? 'awaiting_phone_pairing'
                    : 'requesting_phone_pairing';
        }

        if (connection !== 'close') {
            return;
        }
        const disconnectCode = lastDisconnect?.error?.output?.statusCode;
        if (!state.creds.registered) {
            whatsappSocket = undefined;
            whatsappStatus = 'phone_pairing_failed';
            console.error(
                `WhatsApp disconnected before phone pairing completed (status ${disconnectCode ?? 'unknown'}). No new pairing code will be requested automatically.`,
                lastDisconnect?.error,
            );
            return;
        }

        if (disconnectCode === DisconnectReason.loggedOut) {
            whatsappSocket = undefined;
            whatsappStatus = 'logged_out';
            console.error('WhatsApp logged out. Re-link the account using a phone-number pairing code.');
            return;
        }

        whatsappSocket = undefined;
        whatsappStatus = 'disconnected';
        scheduleReconnect('WhatsApp disconnected', lastDisconnect?.error);
    });

    if (!state.creds.registered) {
        whatsappStatus = 'requesting_phone_pairing';
        setTimeout(() => {
            if (whatsappSocket !== socket) {
                return;
            }

            socket.requestPairingCode(pairingPhoneNumber).then((code) => {
                pairingCodeIssued = true;
                whatsappStatus = 'awaiting_phone_pairing';
                console.log(`WhatsApp pairing code: ${code}`);
                console.log('Use this code on your phone under WhatsApp > Linked devices > Link a device > Link with phone number instead. No replacement code will be requested automatically.');
            }).catch((error) => {
                whatsappStatus = 'phone_pairing_failed';
                console.error('WhatsApp phone-number pairing failed:', error);
            });
        }, 1000);
    }

}

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

function requireConnectedSocket(action) {
    const socket = whatsappSocket;
    if (!socket || whatsappStatus !== 'connected') {
        throw new Error(`WhatsApp is not connected; cannot post the ${action}.`);
    }
    return socket;
}

// Sends to every group with a random pause in between, so groups are not hit in one burst.
async function sendToGroups(socket, buildContent) {
    for (const [index, groupId] of groupIds.entries()) {
        if (index > 0) {
            await sleep(randomBetween(20_000, 90_000));
        }
        await socket.sendMessage(groupId, buildContent());
    }
}

async function sendDailyImage(entry, dayNumber) {
    const weekday = weekdayNameFor(new Date(), timezone);
    const image = selectWeekdayImage(await listImagesInFolder(), weekday);
    if (!image) {
        console.log(`Skipping ${entry.id}; ${weekday}.png was not found in the configured Drive folder.`);
        return;
    }

    const response = await driveClient.files.get(
        { fileId: image.id, alt: 'media' },
        { responseType: 'arraybuffer' },
    );
    const socket = requireConnectedSocket('scheduled image');
    const media = Buffer.from(response.data);
    const caption = captionFor(weekday, dayNumber, entry.variant);
    await sendToGroups(socket, () => ({
        image: media,
        mimetype: image.mimeType,
        caption,
    }));

    console.log(`Posted ${image.name} with a caption to ${groupIds.length} group(s) (${entry.id}).`);
}

async function sendDailyMessage(entry, dayNumber) {
    const socket = requireConnectedSocket('scheduled message');
    const text = messageFor(dayNumber, entry.variant);
    await sendToGroups(socket, () => ({ text }));

    console.log(`Posted the message to ${groupIds.length} group(s) (${entry.id}).`);
}

async function sendCountdownMessage() {
    const days = countdownDaysFor(new Date(), timezone);
    if (days === undefined) {
        return;
    }

    const socket = requireConnectedSocket('countdown message');
    const text = countdownMessage(days);
    await sendToGroups(socket, () => ({ text }));

    console.log(`Posted the ${days}-day conference countdown to ${groupIds.length} group(s).`);
}

function loadPlan() {
    try {
        return JSON.parse(fs.readFileSync(planPath, 'utf8'));
    } catch {
        return undefined;
    }
}

function savePlan(plan) {
    try {
        fs.mkdirSync(path.dirname(planPath), { recursive: true });
        fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
    } catch (error) {
        console.error('Could not save the daily plan:', error);
    }
}

function formatSeconds(seconds) {
    const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// The plan for the day is saved to disk, so a restart or redeploy resumes it
// instead of generating a second set of posts for the same day.
function ensureTodayPlan() {
    const now = new Date();
    const dateKey = localDateKeyFor(now, timezone);
    const saved = loadPlan();
    if (saved?.dateKey === dateKey) {
        return saved;
    }

    const entries = planDay({
        isWeekday: isWeekdayFor(now, timezone),
        countdownActive: countdownDaysFor(now, timezone) !== undefined,
        fromSecond: localSecondsFor(now, timezone) + 120,
    }).map((entry) => ({ ...entry, status: 'pending' }));
    const plan = { dateKey, entries };
    savePlan(plan);
    console.log(`Plan for ${dateKey} (${timezone}): ${entries.map((entry) => `${entry.type}@${formatSeconds(entry.atSecond)}`).join(', ') || 'no posts'}.`);
    return plan;
}

async function runEntry(plan, entry) {
    if (plan.dateKey !== localDateKeyFor(new Date(), timezone)) {
        entry.status = 'missed';
        savePlan(plan);
        return;
    }

    if (paused) {
        entry.status = 'skipped (paused)';
        lastResult = `${entry.id} skipped because posting is paused`;
        console.log(`Skipping ${entry.id}; posting is paused.`);
        savePlan(plan);
        return;
    }

    const dayNumber = dateInTimeZone(new Date(), timezone) / (24 * 60 * 60 * 1000);
    try {
        if (entry.type === 'image') {
            await sendDailyImage(entry, dayNumber);
        } else if (entry.type === 'countdown') {
            await sendCountdownMessage();
        } else {
            await sendDailyMessage(entry, dayNumber);
        }
        entry.status = 'done';
        lastResult = `${entry.id} posted at ${new Date().toLocaleTimeString('en', { timeZone: timezone })}`;
    } catch (error) {
        // Not retried: a retry could produce a duplicate or an extra burst.
        entry.status = 'failed';
        lastResult = `${entry.id} failed: ${error.message}`;
        console.error(`Failed to post ${entry.id}:`, error);
    }
    savePlan(plan);
}

function schedulePlan(plan) {
    const nowSeconds = localSecondsFor(new Date(), timezone);
    for (const entry of plan.entries) {
        const key = `${plan.dateKey}:${entry.id}`;
        if (entry.status !== 'pending' || scheduledEntries.has(key)) {
            continue;
        }
        if (nowSeconds - entry.atSecond > MAX_LATE_SECONDS) {
            entry.status = 'missed';
            savePlan(plan);
            console.log(`Skipping ${entry.id}; its time (${formatSeconds(entry.atSecond)}) has already passed.`);
            continue;
        }

        scheduledEntries.add(key);
        setTimeout(() => runEntry(plan, entry), Math.max(0, (entry.atSecond - nowSeconds) * 1000));
    }
}

function setupSchedules() {
    if (schedulesStarted) {
        return;
    }
    schedulesStarted = true;

    schedulePlan(ensureTodayPlan());
    cron.schedule('0 0 * * *', () => schedulePlan(ensureTodayPlan()), { timezone, noOverlap: true });
}

connectWhatsApp().catch((error) => {
    whatsappStatus = 'initialization_failed';
    scheduleReconnect('WhatsApp connection initialization failed', error);
});
