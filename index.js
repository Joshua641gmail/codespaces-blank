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
const { ODOI_IMAGE_NAME, selectExtraImage, selectNamedImage, selectOdoiImage, weekdayNameFor } = require('./lib/image-selection');
const { enabledSteps, getChain, slotKey, stepKeys, stepLabel, validateChains } = require('./lib/chain');
const { renderOrderPage } = require('./lib/order-page');
const { renderBackupPage, renderCaptionsPage, renderGroupsPage, renderHomePage, renderSchedulePage } = require('./lib/pages');
const { buildBackup, normalizeSchedule, scheduleWarnings, splitVariants, validateBackup, validateCaptions, validateSchedule } = require('./lib/settings');
const { fail } = require('./lib/validation');
const { localDateKeyFor, localSecondsFor, planDay } = require('./lib/post-schedule');
const { BREILINE_CAPTION, BROLINE_CAPTION, ODOI_CAPTION, drawIndex, drawVariant, formatPost } = require('./lib/content');

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
// Pause between one image and the next inside the same group: about 30 seconds (a few seconds of
// random jitter so it is not an identical gap every time).
const CHAIN_LAG_MS = { min: 25_000, max: 35_000 };
const planPath = path.join(sessionPath, 'daily-plan.json');
const statePath = path.join(sessionPath, 'state.json');
const scheduledEntries = new Set();
// Timers of posts waiting for their time, so a re-plan can cancel the ones it replaces.
const entryTimers = new Map();
// The plan for today, kept in memory so running posts and a re-plan always share one object.
let currentPlan;
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

// Settings changed from the browser pages, all kept in the same state file on the volume.
function getSchedule() {
    return normalizeSchedule(loadState().schedule);
}

function getCustomImages() {
    return loadState().customImages || [];
}

function getCaptions() {
    const saved = loadState().captions || {};
    return { window: saved.window || {}, odoi: saved.odoi || '', broline: saved.broline || '', breiline: saved.breiline || '' };
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

    const token = url.searchParams.get('token');
    const getPaths = ['/pause', '/resume', '/status', '/groups', '/manage', '/order', '/settings', '/schedule', '/captions', '/backup', '/backup.json', '/drivefiles', '/addgroup', '/removegroup'];
    const postPaths = ['/order', '/schedule', '/captions', '/groupsave', '/restore', '/replan'];
    const isPost = request.method === 'POST';
    if ((!isPost && request.method !== 'GET') || !(isPost ? postPaths : getPaths).includes(url.pathname) || !tokenMatches(token)) {
        send(404, 'not found');
        return;
    }

    try {
        if (isPost) {
            await handlePost(url.pathname, request, send);
        } else if (url.pathname === '/order') {
            send(200, orderPage(token), 'text/html');
        } else if (url.pathname === '/settings') {
            send(200, renderHomePage({ token, statusText: statusText(), warning: storageWarning() }), 'text/html');
        } else if (url.pathname === '/schedule') {
            send(200, renderSchedulePage({ token, schedule: getSchedule(), warnings: scheduleWarnings(getSchedule()), todayLines: todayLines(), timezone }), 'text/html');
        } else if (url.pathname === '/captions') {
            send(200, renderCaptionsPage({
                token,
                schedule: getSchedule(),
                captions: getCaptions(),
                customImages: getCustomImages(),
                builtIn: { odoi: ODOI_CAPTION, broline: BROLINE_CAPTION, breiline: BREILINE_CAPTION },
            }), 'text/html');
        } else if (url.pathname === '/backup') {
            send(200, renderBackupPage({ token }), 'text/html');
        } else if (url.pathname === '/backup.json') {
            response.writeHead(200, {
                'content-type': 'application/json; charset=utf-8',
                'content-disposition': `attachment; filename="settings-backup-${localDateKeyFor(new Date(), timezone)}.json"`,
            });
            response.end(JSON.stringify(buildBackup(loadState()), null, 2));
        } else if (url.pathname === '/drivefiles') {
            const names = (await listImagesInFolder().catch(() => [])).map((file) => file.name);
            send(200, JSON.stringify(names), 'application/json');
        } else if (url.pathname === '/groups') {
            send(200, await groupsText());
        } else if (url.pathname === '/manage') {
            send(200, await groupsPage(token), 'text/html');
        } else if (url.pathname === '/addgroup' || url.pathname === '/removegroup') {
            const id = (url.searchParams.get('id') || '').trim();
            if (!GROUP_ID_PATTERN.test(id)) {
                send(400, 'Add id=<group id ending in @g.us> to the link.');
                return;
            }
            const message = await updateGroup(id, url.pathname === '/addgroup' ? 'add' : 'remove');
            if (url.searchParams.get('back') === '1') {
                response.writeHead(302, { location: `/manage?token=${encodeURIComponent(token)}` });
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
        if (error.status === 400) {
            send(400, error.message);
            return;
        }
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

function readBody(request, limit = 300_000) {
    return new Promise((resolve, reject) => {
        let data = '';
        request.on('data', (chunk) => {
            data += chunk;
            if (data.length > limit) {
                reject(new Error('Request too large.'));
                request.destroy();
            }
        });
        request.on('end', () => resolve(data));
        request.on('error', reject);
    });
}

function orderPage(token) {
    const plan = loadPlan();
    const today = {};
    if (plan?.dateKey === localDateKeyFor(new Date(), timezone)) {
        for (const entry of plan.entries) {
            today[slotKey(entry.period, slotOf(plan, entry))] = `Today: ${formatSeconds(entry.atSecond)} - ${entry.status}`;
        }
    }
    return renderOrderPage({ token, chains: loadState().chains, schedule: getSchedule(), customImages: getCustomImages(), today });
}

// Every group this account is in, with whether it can post there and why not.
async function groupRows() {
    const socket = whatsappStatus === 'connected' ? whatsappSocket : undefined;
    if (!socket) {
        return undefined;
    }

    const all = await socket.groupFetchAllParticipating();
    const selected = new Set(getGroupIds());
    const rows = Object.values(all).map((group) => ({
        id: group.id,
        name: String(group.subject || group.id),
        selected: selected.has(group.id),
        reason: blockerFromMetadata(socket, group) || '',
        lastError: groupProblems.get(group.id) || '',
    }));
    for (const id of selected) {
        if (!all[id]) {
            rows.push({ id, name: id, selected: true, reason: "not one of this account's groups any more", lastError: '' });
        }
    }
    return rows.sort((x, y) => x.name.localeCompare(y.name));
}

async function groupsPage(token) {
    const rows = await groupRows();
    return renderGroupsPage({
        token,
        connected: Boolean(rows),
        groups: rows || [],
        warning: storageWarning(),
        envLine: `WHATSAPP_GROUP_IDS=${getGroupIds().join(',')}`,
    });
}

// Sets the posting list to the ticked groups. Groups that cannot be posted to are never added.
async function saveGroupSelection(ids) {
    if (!Array.isArray(ids) || !ids.every((id) => GROUP_ID_PATTERN.test(id))) {
        fail('ids must be a list of group IDs.');
    }
    const rows = await groupRows();
    if (!rows) {
        fail('WhatsApp is not connected yet; try again in a minute.');
    }

    const byId = new Map(rows.map((row) => [row.id, row]));
    const current = new Set(getGroupIds());
    const wanted = new Set(ids);
    let added = 0;
    let removed = 0;
    const refused = [];
    for (const id of wanted) {
        if (current.has(id)) {
            continue;
        }
        const row = byId.get(id);
        if (!row || row.reason) {
            refused.push(`${row?.name || id}: ${row?.reason || 'not one of this account\'s groups'}`);
            continue;
        }
        changeGroupList(id, 'add');
        added += 1;
    }
    for (const id of current) {
        if (!wanted.has(id)) {
            changeGroupList(id, 'remove');
            removed += 1;
        }
    }
    const lines = [`Saved. Added ${added}, removed ${removed}. Now posting to ${getGroupIds().length} group(s).`];
    if (refused.length > 0) {
        lines.push('Not added:', ...refused);
    }
    console.log(`Groups updated from the Groups page: +${added} -${removed}.`);
    return lines.join('\n');
}

// Changes saved from the settings pages. Nothing here needs a redeploy.
async function handlePost(pathname, request, send) {
    let body;
    try {
        body = JSON.parse((await readBody(request)) || '{}');
    } catch {
        send(400, 'That is not valid JSON.');
        return;
    }

    const json = (payload) => send(200, JSON.stringify(payload), 'application/json');
    if (pathname === '/order') {
        saveState({ chains: validateChains(body, stepKeys(getCustomImages())) });
        console.log('Post image order updated from the settings page.');
        send(200, 'saved');
    } else if (pathname === '/schedule') {
        const schedule = validateSchedule(body.schedule);
        saveState({ schedule });
        console.log('Schedule updated from the settings page.');
        const message = body.replan ? `Saved. ${replanToday()}` : 'Saved. It applies from the next day\'s plan.';
        json({ message, warnings: scheduleWarnings(schedule), today: todayLines().join('\n') });
    } else if (pathname === '/replan') {
        json({ message: replanToday(), today: todayLines().join('\n') });
    } else if (pathname === '/captions') {
        const { captions, customImages } = validateCaptions(body);
        saveState({ captions, customImages });
        console.log('Texts updated from the settings page.');
        send(200, 'saved');
    } else if (pathname === '/groupsave') {
        json({ message: await saveGroupSelection(body.ids) });
    } else if (pathname === '/restore') {
        const patch = validateBackup(body);
        saveState(patch);
        groupCheckCache.clear();
        console.log(`Settings restored from a backup: ${Object.keys(patch).join(', ') || 'nothing'}.`);
        json({ message: `Restored: ${Object.keys(patch).join(', ') || 'nothing found in the file'}. It applies to posts that have not started yet.` });
    }
}

function messageText(message) {
    const content = normalizeMessageContent(message.message);
    return (content?.conversation || content?.extendedTextMessage?.text || '').trim();
}

// Which post of its window this entry is (1 = first, 2 = second, ...), used to look up its image order.
function slotOf(plan, entry) {
    return plan.entries.filter((item) => item.period === entry.period).indexOf(entry) + 1;
}

function chainLabel(plan, entry) {
    const customImages = getCustomImages();
    const windowName = getSchedule().windows.find((window) => window.id === entry.period)?.name || entry.period;
    const steps = enabledSteps(getChain(loadState().chains, entry.period, slotOf(plan, entry), stepKeys(customImages)));
    return steps.map((key) => stepLabel(key, windowName, customImages)).join(' > ') || 'nothing';
}

// What is planned (and how it went) for the rest of today, one line per post.
function todayLines() {
    const plan = loadPlan();
    if (plan?.dateKey !== localDateKeyFor(new Date(), timezone)) {
        return [];
    }
    return plan.entries.map((entry) => `${formatSeconds(entry.atSecond)} ${chainLabel(plan, entry)} - ${entry.status}`);
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
    if (todayLines().length > 0) {
        lines.push(`Today (${timezone}):`, ...todayLines());
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
// A definite reason this account cannot post in a group, from its metadata, or undefined.
function blockerFromMetadata(socket, metadata) {
    const mine = [socket.user?.id, socket.user?.lid].filter(Boolean).map((id) => jidNormalizedUser(id));
    const self = metadata.participants?.find((participant) => (
        [participant.id, participant.lid, participant.phoneNumber]
            .filter(Boolean)
            .some((id) => mine.includes(jidNormalizedUser(id)))
    ));
    if (metadata.announce && self && !self.admin) {
        return 'only admins can post in this group';
    }
    return undefined;
}

async function groupBlocker(socket, groupId) {
    const cached = groupCheckCache.get(groupId);
    if (cached && Date.now() - cached.at < GROUP_CHECK_TTL_MS) {
        return cached.problem;
    }

    let problem;
    try {
        problem = blockerFromMetadata(socket, await socket.groupMetadata(groupId));
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
// (the ODOI, BROLINE and BREILINE images follow the window's image in the same group). A group that cannot be posted to
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
            await sleep(randomBetween(CHAIN_LAG_MS.min, CHAIN_LAG_MS.max));
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

// Builds what is sent for one step of a post chain, or undefined (with a log line) when that
// step cannot be sent, so the rest of the chain still goes out.
async function buildStep(key, entry, files, wordingHolder) {
    const captions = getCaptions();

    if (key === 'regular') {
        const window = getSchedule().windows.find((item) => item.id === entry.period);
        if (!window) {
            console.log(`Window "${entry.period}" no longer exists; skipping its image (${entry.id}).`);
            return undefined;
        }

        const image = window.image ? selectNamedImage(files, window.image) : undefined;
        if (window.image && !image && !window.textIfMissing) {
            console.log(`${window.image} was not found in the configured Drive folder; skipping that image (${entry.id}).`);
            return undefined;
        }

        // Your own text for this window (several separated by ---) replaces the built-in messages.
        const wording = loadState().wording || {};
        const own = splitVariants(captions.window[window.id]);
        let caption;
        if (own.length > 0) {
            const draw = drawIndex(own.length, wording[`custom:${window.id}`]);
            caption = own[draw.index];
            wordingHolder.pending = { key: `custom:${window.id}`, state: draw.state };
        } else {
            const draw = drawVariant(window.style, wording[window.style]);
            caption = formatPost(window.style, draw.index);
            wordingHolder.pending = { key: window.style, state: draw.state };
        }
        return image
            ? { image: await downloadImage(image), mimetype: image.mimeType, caption }
            : { text: caption };
    }

    let image;
    let caption;
    let label;
    if (key === 'odoi') {
        label = ODOI_IMAGE_NAME;
        image = selectOdoiImage(files);
        caption = captions.odoi || ODOI_CAPTION;
    } else if (key === 'broline' || key === 'breiline') {
        label = key.toUpperCase();
        image = selectExtraImage(files, label);
        caption = captions[key] || (key === 'broline' ? BROLINE_CAPTION : BREILINE_CAPTION);
    } else {
        const custom = getCustomImages().find((item) => item.id === key);
        if (!custom) {
            console.log(`Custom image ${key} no longer exists; skipping it (${entry.id}).`);
            return undefined;
        }
        label = custom.file;
        image = selectNamedImage(files, custom.file);
        caption = custom.caption;
    }

    if (!image) {
        console.log(`${label} was not found in the configured Drive folder; skipping it (${entry.id}).`);
        return undefined;
    }
    const content = { image: await downloadImage(image), mimetype: image.mimeType };
    if (caption) {
        content.caption = caption;
    }
    return content;
}

async function sendDailyImage(entry, { slot, alreadySent, onSent }) {
    const files = await listImagesInFolder();
    // The order is read now, so whatever was saved on the settings pages before this post started applies.
    const steps = enabledSteps(getChain(loadState().chains, entry.period, slot, stepKeys(getCustomImages())));

    if (!await waitForConnection()) {
        throw new Error(`WhatsApp is not connected; cannot post ${entry.id}.`);
    }

    const wordingHolder = {};
    const messages = [];
    for (const key of steps) {
        try {
            const content = await buildStep(key, entry, files, wordingHolder);
            if (content) {
                messages.push(content);
            }
        } catch (error) {
            console.error(`Could not prepare the ${key} step of ${entry.id}; skipping it:`, error);
            if (key === 'regular') {
                wordingHolder.pending = undefined;
            }
        }
    }
    if (messages.length === 0) {
        console.log(`Nothing to post for ${entry.id}.`);
        return undefined;
    }

    const result = await sendToGroups(messages, { alreadySent, onSent });
    // Only mark the wording as used when it actually reached a group.
    if (wordingHolder.pending && result.sent > 0) {
        const wording = loadState().wording || {};
        saveState({ wording: { ...wording, [wordingHolder.pending.key]: wordingHolder.pending.state } });
    }

    console.log(`Posted ${messages.length} image(s) per group to ${describeResult(result)} (${entry.id}).`);
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

    const entries = (dateKey > lastPostDate ? [] : planDay({
        schedule: getSchedule(),
        dateKey,
        weekday: weekdayNameFor(now, timezone),
        fromSecond: localSecondsFor(now, timezone) + 120,
    })).map((entry) => ({ ...entry, status: 'pending' }));
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
                slot: slotOf(plan, entry),
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
        entryTimers.set(key, setTimeout(() => runEntry(plan, entry), Math.max(0, (entry.atSecond - nowSeconds) * 1000)));
    }
}

// Re-plans what is left of today from the current schedule. Posts already sent, running or
// failed stay as they are and count towards their window; everything still pending is replaced.
function replanToday() {
    const now = new Date();
    const dateKey = localDateKeyFor(now, timezone);
    if (!currentPlan || currentPlan.dateKey !== dateKey) {
        currentPlan = ensureTodayPlan();
        schedulePlan(currentPlan);
    }
    const plan = currentPlan;

    for (const entry of plan.entries.filter((item) => item.status === 'pending')) {
        const key = `${plan.dateKey}:${entry.id}`;
        clearTimeout(entryTimers.get(key));
        entryTimers.delete(key);
        scheduledEntries.delete(key);
    }

    const kept = plan.entries.filter((entry) => entry.status !== 'pending');
    const doneByWindow = {};
    for (const entry of kept) {
        if (/^(done|running|failed)/.test(entry.status)) {
            doneByWindow[entry.period] = (doneByWindow[entry.period] || 0) + 1;
        }
    }

    const fresh = (dateKey > lastPostDate ? [] : planDay({
        schedule: getSchedule(),
        dateKey,
        weekday: weekdayNameFor(now, timezone),
        fromSecond: localSecondsFor(now, timezone) + 120,
        doneByWindow,
        idSuffix: `r${Date.now().toString(36)}-`,
    })).map((entry) => ({ ...entry, status: 'pending' }));

    plan.entries = [...kept, ...fresh].sort((a, b) => a.atSecond - b.atSecond);
    savePlan(plan);
    schedulePlan(plan);
    console.log(`Re-planned today: ${fresh.map((entry) => `${entry.period}@${formatSeconds(entry.atSecond)}`).join(', ') || 'nothing more'}.`);
    return fresh.length > 0
        ? `Re-planned today: ${fresh.length} post(s) still to come.`
        : 'Re-planned today: no more posts fit in the rest of today.';
}

function setupSchedules() {
    if (schedulesStarted) {
        return;
    }
    schedulesStarted = true;

    currentPlan = ensureTodayPlan();
    schedulePlan(currentPlan);
    cron.schedule('0 0 * * *', () => {
        currentPlan = ensureTodayPlan();
        schedulePlan(currentPlan);
    }, { timezone, noOverlap: true });
}

connectWhatsApp().catch((error) => {
    whatsappStatus = 'initialization_failed';
    scheduleReconnect('WhatsApp connection initialization failed', error);
});
