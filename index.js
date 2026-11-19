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
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const pino = require('pino');
require('dotenv').config();
const { ODOI_IMAGE_NAME, isPostingDay, selectImage, selectOdoiImage, weekdayNameFor } = require('./lib/image-selection');
const { localDateKeyFor, localSecondsFor, planDay } = require('./lib/post-schedule');
const { ODOI_CAPTION, drawVariant, formatPost } = require('./lib/content');

const timezone = process.env.SCHEDULE_TIMEZONE || 'Africa/Nairobi';
const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
// Groups from the Railway variable. Groups added or removed with !addgroup / !removegroup are
// kept in state.json on the volume and applied on top of this list (see getGroupIds).
const envGroupIds = (process.env.WHATSAPP_GROUP_IDS || '')
    .split(',')
    .map((groupId) => groupId.trim())
    .filter(Boolean);
const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDS_JSON;
// Last day posts are sent (inclusive), as YYYY-MM-DD in the schedule timezone.
const lastPostDate = process.env.LAST_POST_DATE?.trim() || '2026-12-05';
const sessionPath = process.env.WHATSAPP_AUTH_PATH || path.join(process.cwd(), '.baileys_auth');
const pairingPhoneNumber = process.env.WHATSAPP_PHONE_NUMBER?.trim();
// The word that, sent by you inside a group, adds that group (and deletes itself), like !addgroup.
// Defaults to YHWH (any case); set ADD_GROUP_WORD to change it, or to a blank/short value to turn it off.
const rawAddGroupWord = (process.env.ADD_GROUP_WORD ?? 'yhwh').trim().toLowerCase();
const addGroupWord = rawAddGroupWord && /^\S{4,}$/.test(rawAddGroupWord) ? rawAddGroupWord : undefined;
if (rawAddGroupWord && !addGroupWord) {
    console.warn('ADD_GROUP_WORD is ignored: it must be one word of at least 4 characters.');
}

if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID must be set.');
}
if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must contain the Google service-account JSON.');
}
if (!pairingPhoneNumber) {
    throw new Error('WHATSAPP_PHONE_NUMBER must be set to link WhatsApp by phone number.');
}
if (envGroupIds.some((groupId) => !groupId.endsWith('@g.us'))) {
    throw new Error('WHATSAPP_GROUP_IDS must contain WhatsApp group IDs ending in @g.us.');
}
if (!/^[1-9]\d{6,14}$/.test(pairingPhoneNumber)) {
    throw new Error('WHATSAPP_PHONE_NUMBER must use international format with digits only, including the country code.');
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(lastPostDate)) {
    throw new Error('LAST_POST_DATE must look like 2026-12-05.');
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
// A post that was interrupted part-way (restart, redeploy) is resumed for the groups not yet
// posted to, as long as it is not older than this.
const MAX_RESUME_SECONDS = 3 * 60 * 60;
// How long a post waits for WhatsApp to reconnect after a drop before giving up on the rest.
const RECONNECT_WAIT_MS = 10 * 60 * 1000;
// On a deploy/stop signal, wait this long for a post in progress to finish before exiting.
const SHUTDOWN_WAIT_MS = (Number(process.env.GRACEFUL_SHUTDOWN_MINUTES) || 30) * 60 * 1000;
let activePosts = 0;
const PLAN_VERSION = 4;
// ODOI follows each morning/evening post in the same group about a minute later (random, so not a fixed gap).
const ODOI_LAG_MS = { min: 45_000, max: 100_000 };
const planPath = path.join(sessionPath, 'daily-plan.json');
const statePath = path.join(sessionPath, 'state.json');
const scheduledEntries = new Set();
// Commands older than this are ignored, so replayed chat history never pauses or resumes anything.
const COMMAND_MAX_AGE_SECONDS = 120;

// Small saved state (pause flag and which wording has been used), kept on the volume so it
// survives restarts and redeploys.
function loadState() {
    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
        return {};
    }
}

function saveState(patch) {
    try {
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify({ ...loadState(), ...patch }));
    } catch (error) {
        console.error('Could not save the state file:', error);
    }
}

function loadPaused() {
    return loadState().paused === true;
}

let paused = loadPaused();
let lastResult = 'none yet';

// Groups the account cannot post to right now (removed, admins-only, send errors), shown in !status.
const groupProblems = new Map();
const groupCheckCache = new Map();
const GROUP_CHECK_TTL_MS = 20 * 60 * 1000;

const GROUP_ID_PATTERN = /^[\d-]+@g\.us$/;

// Groups to post to: the Railway list plus groups added with !addgroup, minus removed ones.
function getGroupIds() {
    const state = loadState();
    const removed = new Set(state.removedGroups || []);
    return [...new Set([...envGroupIds, ...(state.addedGroups || [])])].filter((id) => !removed.has(id));
}

function changeGroupList(groupId, action) {
    const state = loadState();
    const added = new Set(state.addedGroups || []);
    const removed = new Set(state.removedGroups || []);
    const wasIn = getGroupIds().includes(groupId);
    if (action === 'add') {
        added.add(groupId);
        removed.delete(groupId);
    } else {
        added.delete(groupId);
        removed.add(groupId);
    }
    saveState({ addedGroups: [...added], removedGroups: [...removed] });
    groupCheckCache.delete(groupId);
    groupProblems.delete(groupId);
    return { wasIn, count: getGroupIds().length };
}

// Groups and the daily plan are saved next to the WhatsApp login. If that folder is not on a
// persistent volume, every deploy wipes them, so say so loudly.
function storageWarning() {
    if (!process.env.WHATSAPP_AUTH_PATH) {
        return 'WARNING: WHATSAPP_AUTH_PATH is not set, so added groups are lost on every deploy. Mount a Railway volume and set it (for example /data/baileys_auth).';
    }
    try {
        if (fs.statSync(sessionPath).dev === fs.statSync(process.cwd()).dev) {
            return 'WARNING: the storage folder looks like it is not on a separate volume, so added groups may be lost on deploy.';
        }
    } catch {
        // Folder not created yet; nothing to compare.
    }
    return '';
}

async function groupName(socket, groupId) {
    try {
        return (await socket?.groupMetadata(groupId))?.subject || groupId;
    } catch {
        return groupId;
    }
}

async function groupsText() {
    const ids = getGroupIds();
    if (ids.length === 0) {
        return 'No groups yet. Send !addgroup inside a group to add it.';
    }
    const socket = whatsappStatus === 'connected' ? whatsappSocket : undefined;
    const names = await Promise.all(ids.map((id) => groupName(socket, id)));
    return [
        `Posting to ${ids.length} group(s):`,
        ...names.map((name, index) => `${index + 1}. ${name}`),
        '',
        'To make the list survive any redeploy, set this Railway variable:',
        `WHATSAPP_GROUP_IDS=${ids.join(',')}`,
    ].join('\n');
}

async function updateGroup(groupId, action) {
    const socket = whatsappStatus === 'connected' ? whatsappSocket : undefined;
    const name = await groupName(socket, groupId);
    const { wasIn, count } = changeGroupList(groupId, action);
    if (action === 'add') {
        console.log(`Group added: ${name}.`);
        return wasIn ? `Already in the list: ${name}. Posting to ${count} group(s).` : `Added: ${name}. Now posting to ${count} group(s).`;
    }
    console.log(`Group removed: ${name}.`);
    return wasIn ? `Removed: ${name}. Now posting to ${count} group(s).` : `Was not in the list: ${name}. Posting to ${count} group(s).`;
}

function setPaused(value) {
    paused = value;
    saveState({ paused: value });
    console.log(value ? 'Posting paused.' : 'Posting resumed.');
}

// Log problems instead of letting one stray error crash the service (Railway shows a crash as a failed deploy).
// On a deploy or stop signal, let a post that is in progress finish for all groups first.
let shuttingDown = false;
function shutdownGracefully(signal) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    console.log(`${signal} received; ${activePosts > 0 ? 'waiting for the post in progress to finish' : 'exiting'}.`);
    const deadline = Date.now() + SHUTDOWN_WAIT_MS;
    const check = setInterval(() => {
        if (activePosts === 0 || Date.now() >= deadline) {
            clearInterval(check);
            process.exit(0);
        }
    }, 2000);
}
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
process.on('SIGINT', () => shutdownGracefully('SIGINT'));
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

// Optional control link that does not depend on WhatsApp receiving your messages.
// Set ADMIN_TOKEN (12+ characters) in Railway, then open https://<your-app>/pause?token=... on your phone.
const adminToken = process.env.ADMIN_TOKEN?.trim();
if (adminToken && adminToken.length < 12) {
    console.warn('ADMIN_TOKEN is shorter than 12 characters; the /pause, /resume and /status links are disabled.');
}

function tokenMatches(candidate) {
    if (!adminToken || adminToken.length < 12 || !candidate) {
        return false;
    }
    const a = crypto.createHash('sha256').update(candidate).digest();
    const b = crypto.createHash('sha256').update(adminToken).digest();
    return crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    const send = (status, body, type = 'text/plain') => {
        response.writeHead(status, { 'content-type': `${type}; charset=utf-8` });
        response.end(body);
    };

    if (request.method === 'GET' && url.pathname === '/health') {
        send(200, JSON.stringify({ status: 'ok', whatsapp: whatsappStatus, paused, lastResult }), 'application/json');
        return;
    }

    const adminPaths = ['/pause', '/resume', '/status', '/groups', '/manage', '/addgroup', '/removegroup'];
    if (request.method !== 'GET' || !adminPaths.includes(url.pathname) || !tokenMatches(url.searchParams.get('token'))) {
        send(404, 'not found');
        return;
    }

    try {
        if (url.pathname === '/groups') {
            send(200, await groupsText());
        } else if (url.pathname === '/manage') {
            send(200, await manageGroupsPage(url.searchParams.get('token')), 'text/html');
        } else if (url.pathname === '/addgroup' || url.pathname === '/removegroup') {
            const id = (url.searchParams.get('id') || '').trim();
            if (!GROUP_ID_PATTERN.test(id)) {
                send(400, 'Add id=<group id ending in @g.us> to the link.');
                return;
            }
            const message = await updateGroup(id, url.pathname === '/addgroup' ? 'add' : 'remove');
            if (url.searchParams.get('back') === '1') {
                response.writeHead(302, { location: `/manage?token=${encodeURIComponent(url.searchParams.get('token'))}` });
                response.end();
                return;
            }
            send(200, message);
        } else {
            if (url.pathname === '/pause') {
                setPaused(true);
            } else if (url.pathname === '/resume') {
                setPaused(false);
            }
            send(200, statusText());
        }
    } catch (error) {
        console.error('Admin link failed:', error);
        send(500, 'Something went wrong; check the logs.');
    }
});

server.on('error', (error) => {
    console.error('HTTP health server failed:', error);
    process.exitCode = 1;
});
server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => {
    console.log(`Health endpoint listening on port ${server.address().port}.`);
});

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// Browser page listing every group this account is in, with its ID and add/remove buttons,
// so you never need to type anything inside a group.
async function manageGroupsPage(token) {
    const page = (body) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Groups</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:1rem auto;padding:0 1rem}li{margin:.7rem 0;padding:.6rem;border:1px solid #8884;border-radius:8px}code{font-size:.8rem;word-break:break-all}a.b{display:inline-block;margin-top:.4rem;padding:.3rem .8rem;border-radius:6px;background:#1a7f4b;color:#fff;text-decoration:none}a.r{background:#b3261e}</style>${body}`;
    if (whatsappStatus !== 'connected' || !whatsappSocket) {
        return page('<p>WhatsApp is not connected yet. Refresh in a minute.</p>');
    }

    const all = Object.values(await whatsappSocket.groupFetchAllParticipating());
    all.sort((x, y) => String(x.subject).localeCompare(String(y.subject)));
    const posting = new Set(getGroupIds());
    const encodedToken = encodeURIComponent(token);
    const items = all.map((group) => {
        const on = posting.has(group.id);
        const action = on ? 'removegroup' : 'addgroup';
        return `<li><b>${escapeHtml(group.subject)}</b> ${on ? '(posting)' : ''}<br><code>${escapeHtml(group.id)}</code><br>`
            + `<a class="b ${on ? 'r' : ''}" href="/${action}?token=${encodedToken}&id=${encodeURIComponent(group.id)}&back=1">${on ? 'Remove' : 'Add'}</a></li>`;
    });
    const warning = storageWarning();
    return page(`<h2>Groups (${posting.size} posting)</h2>${warning ? `<p><b>${escapeHtml(warning)}</b></p>` : ''}<ul style="list-style:none;padding:0">${items.join('')}</ul>`
        + `<p>To make the list permanent even without a volume, set <code>WHATSAPP_GROUP_IDS=${escapeHtml([...posting].join(','))}</code> in Railway.</p>`);
}

function messageText(message) {
    const content = normalizeMessageContent(message.message);
    return (content?.conversation || content?.extendedTextMessage?.text || '').trim();
}

function statusText() {
    const plan = loadPlan();
    const lines = [
        `Posting: ${paused ? 'PAUSED' : 'ACTIVE'}`,
        `WhatsApp: ${whatsappStatus}`,
        `Last result: ${lastResult}`,
        `Groups: ${getGroupIds().length} (last post day: ${lastPostDate})`,
    ];
    if (storageWarning()) {
        lines.push(storageWarning());
    }
    if (groupProblems.size > 0) {
        lines.push('Groups being skipped:');
        for (const [groupId, reason] of groupProblems) {
            lines.push(`${groupId.slice(0, 12)}... - ${reason}`);
        }
    }
    if (plan?.dateKey === localDateKeyFor(new Date(), timezone) && plan.entries.length > 0) {
        lines.push(`Today (${timezone}):`);
        for (const entry of plan.entries) {
            lines.push(`${formatSeconds(entry.atSecond)} ${entry.period} image + ODOI - ${entry.status}`);
        }
    } else {
        lines.push('No posts planned for the rest of today.');
    }
    return lines.join('\n');
}

// Commands, sent from the linked phone (only your own account is ever obeyed):
//   !status, !pause, !resume   - control posting
//   !groups                    - list the groups being posted to
//   !addgroup / !removegroup   - send inside a group to add or remove it
//   !getid                     - inside a group, replies with the group ID
// Replies always go to your own "Message yourself" chat, so nobody else sees them. A command
// sent inside a group is deleted from that group afterwards.
const COMMAND_PATTERN = /^(?:!getid|getid!|!pause|!resume|!status|!groups|!addgroup|!removegroup)$/i;

async function handleCommand(socket, message) {
    const chatId = message.key.remoteJid;
    let body = messageText(message);
    const isKeyword = Boolean(addGroupWord) && body.toLowerCase() === addGroupWord;
    if (isKeyword) {
        // Only meaningful inside a group; anywhere else it is just a normal message.
        if (!message.key.fromMe || !chatId?.endsWith('@g.us')) {
            return;
        }
        body = '!addgroup';
    } else if (!COMMAND_PATTERN.test(body)) {
        return;
    }
    console.log(`Command "${isKeyword ? 'group keyword' : body}" seen (fromMe=${Boolean(message.key.fromMe)}, chat=${chatId?.split('@')[1] || 'unknown'}).`);
    if (!message.key.fromMe) {
        return;
    }
    const timestamp = message.messageTimestamp?.toNumber?.() ?? Number(message.messageTimestamp || 0);
    if (Date.now() / 1000 - timestamp > COMMAND_MAX_AGE_SECONDS) {
        console.log('Ignoring an old command.');
        return;
    }

    try {
        const command = body.toLowerCase();
        const inGroup = Boolean(chatId?.endsWith('@g.us'));
        if (command === '!getid' || command === 'getid!') {
            if (inGroup) {
                await socket.sendMessage(chatId, { text: `Group ID: ${chatId}` });
            }
            return;
        }
        if (!chatId || chatId.endsWith('@broadcast')) {
            return;
        }

        let reply;
        if (command === '!addgroup' || command === '!removegroup') {
            reply = inGroup
                ? await updateGroup(chatId, command === '!addgroup' ? 'add' : 'remove')
                : `Send ${command} inside the group you want to ${command === '!addgroup' ? 'add' : 'remove'}.`;
        } else if (command === '!pause') {
            setPaused(true);
            reply = 'Posting paused. Send !resume to continue.';
        } else if (command === '!resume') {
            setPaused(false);
            reply = 'Posting resumed.';
        } else if (command === '!groups') {
            reply = await groupsText();
        } else {
            reply = statusText();
        }

        await socket.sendMessage(jidNormalizedUser(socket.user?.id || chatId), { text: reply });

        if (inGroup) {
            try {
                await socket.sendMessage(chatId, { delete: message.key });
            } catch (error) {
                console.warn('Could not delete the command message from the group:', error.message);
            }
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
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
        for (const message of messages) {
            if (message.key.fromMe && !message.key.remoteJid?.endsWith('@g.us') && !message.key.remoteJid?.endsWith('@broadcast')) {
                console.log(`Own one-to-one message received (upsert ${type}, ${message.message ? 'readable' : 'could not be read'}).`);
            }
            await handleCommand(socket, message);
        }
    });
    socket.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            whatsappStatus = 'connected';
            reconnectAttempts = 0;
            console.log('WhatsApp client is ready.');
            if (getGroupIds().length === 0) {
                console.log('WhatsApp connected, but no groups are set. Send !addgroup inside each target group.');
            }
            if (storageWarning()) {
                console.warn(storageWarning());
            }
            console.log(`WhatsApp connected. Daily randomized post plan active (${timezone}, last post day ${lastPostDate}).`);
            setupSchedules();
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

// Works out whether this account can post in a group. Only definite problems skip a
// group (it was removed, or only admins may post and we are not one); anything unclear
// is treated as "try sending".
async function groupBlocker(socket, groupId) {
    const cached = groupCheckCache.get(groupId);
    if (cached && Date.now() - cached.at < GROUP_CHECK_TTL_MS) {
        return cached.problem;
    }

    let problem;
    try {
        const metadata = await socket.groupMetadata(groupId);
        const mine = [socket.user?.id, socket.user?.lid].filter(Boolean).map((id) => jidNormalizedUser(id));
        const self = metadata.participants?.find((participant) => (
            [participant.id, participant.lid, participant.phoneNumber]
                .filter(Boolean)
                .some((id) => mine.includes(jidNormalizedUser(id)))
        ));
        if (metadata.announce && self && !self.admin) {
            problem = 'only admins can post in this group';
        }
    } catch (error) {
        const code = error?.output?.statusCode ?? error?.data;
        if ([403, 404].includes(code) || /forbidden|not-authorized|item-not-found/i.test(String(error?.message))) {
            problem = 'removed from this group or it no longer exists';
        }
    }

    groupCheckCache.set(groupId, { at: Date.now(), problem });
    return problem;
}

// Waits (up to maxMs) for WhatsApp to be connected and returns the live socket. The socket is
// looked up again for every send, so a reconnect in the middle of a long post run is picked up.
async function waitForConnection(maxMs = RECONNECT_WAIT_MS) {
    const deadline = Date.now() + maxMs;
    for (;;) {
        if (whatsappStatus === 'connected' && whatsappSocket) {
            return whatsappSocket;
        }
        if (Date.now() >= deadline) {
            return undefined;
        }
        await sleep(5000);
    }
}

// Sends one message on the current connection. If the connection closed under it, waits for the
// reconnect and tries once more (a closed connection never sent the message, so no duplicate).
async function sendLive(groupId, content) {
    for (let attempt = 1; ; attempt += 1) {
        const socket = await waitForConnection();
        if (!socket) {
            throw new Error('WhatsApp stayed disconnected');
        }
        try {
            return await socket.sendMessage(groupId, content);
        } catch (error) {
            if (attempt >= 2 || !/connection (closed|failure|lost)|not connected|stream errored/i.test(String(error?.message))) {
                throw error;
            }
            console.warn(`Connection dropped while posting to ${groupId}; waiting for it to come back.`);
            await sleep(5000);
        }
    }
}

// Sends to every group with a random pause in between, so groups are not hit in one burst.
// `messages` is sent to each group in order, with a random lag of about a minute between them
// (the ODOI post follows the regular post in the same group). A group that cannot be posted to
// is skipped and the others still get the post. Groups in `alreadySent` (from an interrupted
// run of the same post) are left alone, and `onSent` is told about every group as it is done.
async function sendToGroups(messages, { alreadySent = [], onSent = () => {} } = {}) {
    const result = { sent: 0, skipped: 0, failed: 0 };
    const groupIds = getGroupIds().filter((groupId) => !alreadySent.includes(groupId));
    let attempted = 0;

    for (const [position, groupId] of groupIds.entries()) {
        const socket = await waitForConnection();
        if (!socket) {
            console.error('WhatsApp stayed disconnected; the remaining groups were not posted to.');
            result.failed += groupIds.length - position;
            break;
        }

        const problem = await groupBlocker(socket, groupId);
        if (problem) {
            groupProblems.set(groupId, problem);
            console.warn(`Skipping group ${groupId}: ${problem}.`);
            result.skipped += 1;
            continue;
        }

        if (attempted > 0) {
            await sleep(randomBetween(20_000, 90_000));
        }
        attempted += 1;
        try {
            await sendLive(groupId, messages[0]);
            groupProblems.delete(groupId);
            result.sent += 1;
            onSent(groupId);
        } catch (error) {
            groupProblems.set(groupId, `send failed: ${error.message}`);
            console.error(`Could not post to group ${groupId}:`, error);
            result.failed += 1;
            continue;
        }

        for (const followUp of messages.slice(1)) {
            await sleep(randomBetween(ODOI_LAG_MS.min, ODOI_LAG_MS.max));
            try {
                await sendLive(groupId, followUp);
            } catch (error) {
                console.error(`Could not send the follow-up post to group ${groupId}:`, error);
            }
        }
    }

    return result;
}

function describeResult(result) {
    const total = result.sent + result.skipped + result.failed;
    return `${result.sent}/${total} group(s)`;
}

async function downloadImage(image) {
    const response = await driveClient.files.get(
        { fileId: image.id, alt: 'media' },
        { responseType: 'arraybuffer' },
    );
    return Buffer.from(response.data);
}

async function sendDailyImage(entry, { alreadySent, onSent }) {
    const period = entry.period;
    const isAfternoon = period === 'afternoon';
    const files = await listImagesInFolder();
    const image = selectImage(files, period);
    // Morning and evening need their image; the Saturday afternoon post falls back to text only.
    if (!image && !isAfternoon) {
        console.log(`Skipping ${entry.id}; ${period.toUpperCase()}.png was not found in the configured Drive folder.`);
        return undefined;
    }

    if (!await waitForConnection()) {
        throw new Error(`WhatsApp is not connected; cannot post ${entry.id}.`);
    }
    const savedWording = loadState().wording || {};
    const wording = drawVariant(period, savedWording[period]);
    const caption = formatPost(period, wording.index);
    const messages = [image
        ? { image: await downloadImage(image), mimetype: image.mimeType, caption }
        : { text: caption }];

    // ODOI follows every post (morning, afternoon, evening) in the same group. If its image is
    // missing or cannot be fetched, the regular post is still sent on its own.
    {
        try {
            const odoi = selectOdoiImage(files);
            if (odoi) {
                messages.push({ image: await downloadImage(odoi), mimetype: odoi.mimeType, caption: ODOI_CAPTION });
            } else {
                console.log(`${ODOI_IMAGE_NAME} was not found in the configured Drive folder; posting without it (${entry.id}).`);
            }
        } catch (error) {
            console.error(`Could not prepare ${ODOI_IMAGE_NAME}; posting without it (${entry.id}):`, error);
        }
    }

    const result = await sendToGroups(messages, { alreadySent, onSent });
    // Only mark the wording as used when it actually reached a group.
    if (result.sent > 0) {
        saveState({ wording: { ...savedWording, [period]: wording.state } });
    }

    console.log(`Posted ${image?.name || 'a text post'} (${messages.length} message(s) per group) to ${describeResult(result)} (${entry.id}).`);
    return result;
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
    // `version` makes sure a plan saved by an older version of this service is never reused.
    if (saved?.version === PLAN_VERSION && saved.dateKey === dateKey) {
        return saved;
    }

    const entries = planDay({
        isPostingDay: isPostingDay(now, timezone, dateKey, lastPostDate),
        isSaturday: weekdayNameFor(now, timezone) === 'SATURDAY',
        dateKey,
        fromSecond: localSecondsFor(now, timezone) + 120,
    }).map((entry) => ({ ...entry, status: 'pending' }));
    const plan = { version: PLAN_VERSION, dateKey, entries };
    savePlan(plan);
    console.log(`Plan for ${dateKey} (${timezone}): ${entries.map((entry) => `${entry.period}@${formatSeconds(entry.atSecond)}`).join(', ') || 'no posts'}.`);
    return plan;
}

async function runEntry(plan, entry) {
    if (shuttingDown) {
        // Left as it is; the next start picks it up.
        return;
    }
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

    try {
        if (getGroupIds().length === 0) {
            entry.status = 'skipped (no groups set)';
            lastResult = `${entry.id} skipped: no groups are set`;
            savePlan(plan);
            return;
        }
        // Remember which groups are done, so a restart half-way resumes instead of re-posting.
        const alreadySent = entry.sentGroups || [];
        entry.status = 'running';
        entry.sentGroups = [...alreadySent];
        savePlan(plan);
        activePosts += 1;
        let result;
        try {
            result = await sendDailyImage(entry, {
                alreadySent,
                onSent: (groupId) => {
                    entry.sentGroups.push(groupId);
                    savePlan(plan);
                },
            });
        } finally {
            activePosts -= 1;
        }

        if (!result) {
            entry.status = 'skipped (nothing to post)';
        } else if (result.sent + alreadySent.length > 0) {
            entry.status = result.skipped + result.failed === 0
                ? 'done'
                : `done (${describeResult(result)})`;
        } else {
            entry.status = 'failed (no group could be posted to)';
        }
        lastResult = `${entry.id} ${entry.status} at ${new Date().toLocaleTimeString('en', { timeZone: timezone })}`;
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
        const interrupted = entry.status === 'running';
        if ((entry.status !== 'pending' && !interrupted) || scheduledEntries.has(key)) {
            continue;
        }
        if (nowSeconds - entry.atSecond > (interrupted ? MAX_RESUME_SECONDS : MAX_LATE_SECONDS)) {
            entry.status = 'missed';
            savePlan(plan);
            console.log(`Skipping ${entry.id}; its time (${formatSeconds(entry.atSecond)}) has already passed.`);
            continue;
        }

        scheduledEntries.add(key);
        if (interrupted) {
            console.log(`Resuming ${entry.id}; it was interrupted after ${entry.sentGroups?.length || 0} group(s).`);
        }
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
