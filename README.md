# WhatsApp scheduled image poster

This service runs continuously on Railway and posts **images with a caption** to approved WhatsApp groups at random times inside daily windows, until the last post day (default `2026-12-05`, inclusive; change it with `LAST_POST_DATE`). Times are in `Africa/Nairobi` by default (`SCHEDULE_TIMEZONE`).

Almost everything is changed from browser pages, with no redeploy (see **Settings pages** below). What it does out of the box:

| Rule | Default |
|---|---|
| Morning window | 2 posts, random times between 5:00 and 10:00 AM, image `MORNING.png`, Monday to Saturday |
| Saturday afternoon window | 1 post, random time between 12:00 and 16:00, welcome-back wording (6 messages), image `AFTERNOON.png` if present, otherwise text only |
| Evening window | 2 posts, random times between 5:00 and 10:00 PM, image `EVENING.png`, Monday to Saturday |
| Gap between two posts in a window | 1 hour at least |
| 23 November 2026 only | keeps the narrower original times (morning 5:00-7:30 AM, evening 5:00-8:00 PM) |
| Images in each post | A chain sent to each group about 30 s apart: the window image (with its message), then `ODOI.png`, then `BROLINE` (a window's first post) or `BREILINE` (its second post). Each of BROLINE and BREILINE therefore goes out once per window |
| Several groups | 20-90 s random pause between groups |

The images are read from the configured Google Drive folder. Window images, `ODOI.png` and custom images are matched by exact file name; `BROLINE` and `BREILINE` by exact name with any image extension. If one is missing, that image is skipped and the rest of the post still goes out. The day's plan is saved to `daily-plan.json` next to the WhatsApp session, so a restart or redeploy resumes it instead of creating extra posts. A post more than 30 minutes late (for example after an outage) is skipped. If the service starts late in the day, it plans only the rest of the day.

## Settings pages (no redeploy needed)

Set `ADMIN_TOKEN` in Railway (12+ characters), then open `https://YOUR-APP.up.railway.app/settings?token=YOUR_TOKEN`. Everything below is saved on the Railway volume (see "Keeping groups across deploys") and has a Backup page for safety.

- **Groups** (`/manage`): every group the account is in, split into *Posting now*, *Available to add* and *Cannot post in these*, with the reason (only admins can post, removed from the group) and the last send error if any. Groups you cannot post in cannot be ticked. Tick the ones you want and press Save. Nothing is sent to any group from this page.
- **Schedule** (`/schedule`): add, edit or remove windows (name, start and end time, number of posts, minimum gap, days of the week, image file, message style). Special dates let one window use different times on one date. Limits: 8 windows, 6 posts per window, gap of at least 30 minutes, 20 posts per day; the page warns when the volume per day gets high or windows overlap. Saved changes start with the next day's plan. **Save and re-plan today** (or **Only re-plan today**) also re-plans today's posts that have not started yet; posts already sent are never repeated and count towards their window.
- **Image order** (`/order`): for every post, which images are sent and in what order (arrows to move, tick to include). Changes apply to every post that has not started yet, today and on following days. A post already in progress keeps the order it started with. `!status` shows each post's current order.
- **Texts** (`/captions`): the text sent with each image. Your text replaces the built-in one and is sent exactly as written. For a window image, leave the box empty to keep the built-in messages (with greeting and signature) or enter several texts separated by a line containing only `---`; they rotate. The ODOI, BROLINE and BREILINE boxes start with their current text and have a *Restore built-in text* button. You can also add up to 8 **custom images** from the Drive folder, each with its own text, then add them to a post on the Image order page. A caption can be at most 1,024 characters (WhatsApp's limit).
- **Backup** (`/backup`): download all of the above (schedule, texts, custom images, image order, group list) as one file and restore it in one click if the volume is ever lost.

Default ODOI text (`ODOI_CAPTION`), BROLINE text and BREILINE text live in `lib/content.js`; the Texts page overrides them without touching the code.

## Wording

All wording lives in `lib/content.js`. Every post is:

```
🔷 Good morning 🔷   (or 🔷 Good evening 🔷)

<one of the 10 messages for that period>

🔷 𝗠𝗨𝗧𝗦𝗜𝗡𝗭𝗜 𝗔𝗟𝗘𝗫 🔷
🔶 𝗚𝗨𝗜𝗟𝗗 𝗔𝗦𝗣𝗜𝗥𝗔𝗡𝗧 🔶
```

Morning and evening each have their own 10 messages; the Saturday afternoon post has its own 6 (greeting `🔷 Good afternoon 🔷`). A message is not used again until all 10 in its pool have been used once; then a new shuffled round starts that never begins with the message just used. A message only counts as used once it has reached a group. The used lists are kept in `state.json` on the volume.

## Control it without redeploying

Send these from the linked phone, ideally in your own "Message yourself" chat. Only your own account is obeyed, and replies always go to your own chat.

| Command | Effect |
|---|---|
| `!status` | Paused/active, WhatsApp status, last result, group count and today's plan |
| `!pause` / `!resume` | Stop or continue posting (planned posts during a pause are skipped, not queued) |
| `!groups` | Lists the groups being posted to, by name |
| `!addgroup` (or the word `YHWH`) | Send **inside a group** to add it. You get a private confirmation, and the command message is deleted from the group |
| `!removegroup` | Send inside a group to stop posting there |
| `!getid` | Inside a group, replies with that group's ID |

Added and removed groups are saved in `state.json` on the volume and applied on top of `WHATSAPP_GROUP_IDS`, so no redeploy is needed.

**Add a group without typing a command in it:** use the Groups page (`/manage`), described above.

**Add a group with a word:** send exactly `YHWH` (any case) inside a group. It adds the group, replies privately in your own chat, and deletes the message from the group. Only your own account is obeyed. To use a different word, set `ADD_GROUP_WORD` in Railway (one word, 4+ characters).

### Keeping groups across deploys

Groups are saved next to the WhatsApp login in `WHATSAPP_AUTH_PATH`. That folder **must be on a Railway volume**, otherwise every deploy wipes it (`!status` and the settings pages show a warning when it looks like it is not). For a guarantee that does not depend on the volume, `/groups` and `!groups` print a ready-made line `WHATSAPP_GROUP_IDS=...`; paste it into the Railway variables and those groups are always included.

### Control links (more reliable than commands)

Set `ADMIN_TOKEN` in Railway to a private value of 12+ characters, then open these on your phone (replace the domain):

- `https://YOUR-APP.up.railway.app/status?token=YOUR_TOKEN`
- `.../pause?token=...` and `.../resume?token=...`
- `.../groups?token=...` lists the groups
- `.../addgroup?token=...&id=123456789-111@g.us` and `.../removegroup?token=...&id=...`

Anyone with the link can control the bot, so keep the token private. Without `ADMIN_TOKEN` these links do not exist.

## Groups that cannot be posted to

Before each post the bot checks every group. A group is skipped (and the others still get the post) when the account was removed from it, it no longer exists, or only admins can post and the account is not an admin. Skipped groups appear in `!status` and on the Groups page, and are re-checked automatically (every 20 minutes at most).

## Configure

1. Create a Google service account with read-only access to the Drive API and share the image folder with its service-account email.
2. Set the environment variables shown in `.env.example` in Railway. Store the full service-account JSON in `GOOGLE_SERVICE_ACCOUNT_JSON`; never commit it or put it in a Docker image.
3. Set `WHATSAPP_PHONE_NUMBER` to the linked account's international-format number (country code and digits only). The service uses phone-number pairing rather than QR codes. In the Railway logs, copy the pairing code, then on the authorized phone open **WhatsApp → Linked devices → Link a device → Link with phone number instead** and enter the code.
4. In each approved target group, send `!addgroup` from the linked WhatsApp account (or set `WHATSAPP_GROUP_IDS`, comma-separated, if you already know the IDs).
5. Keep the Railway service running and attach a persistent volume. Set `WHATSAPP_AUTH_PATH` to a directory on that volume (for example, `/data/baileys_auth`) so restarts can reuse the WhatsApp session.

## Deploy on Railway

Use this repository's `Dockerfile` as the Railway builder and add the required variables from `.env.example` in Railway's service settings. Keep the service on an always-running plan; a sleeping or stopped service cannot run its scheduled posts. The `/health` endpoint reports service and WhatsApp connection status.

Use Railway's deployment logs to confirm that WhatsApp connects and the daily plan is created. If WhatsApp disconnects, the service retries most disconnects automatically. A logged-out session needs to be paired again. Disable any other deployment that could post the same messages to avoid duplicates.

## Run and test locally

```sh
npm test
npm start
```

This uses Baileys, an unofficial WhatsApp Web protocol library, not the official WhatsApp Business API. Only use it for groups whose admins have approved the scheduled posts. The protocol may change, and automated messaging may carry account restriction risk.

## Credential hygiene

Never commit `.env`, Google service-account keys, or `.baileys_auth`. Ignore rules do not remove previously committed files from Git history. Revoke and replace any exposed Google key, unlink/re-link the WhatsApp session if it was shared, and remove exposed artifacts from repository history before deploying or making the repository public.


## Posting through to the last group

A post can take a long time (pauses between groups, plus about 30 seconds between each image in a group). To make sure every group is reached:

- The live connection is looked up again before every message. If WhatsApp drops, the post waits (up to 10 minutes) for the reconnect and carries on with the remaining groups. A message that failed only because the connection closed is retried once.
- Each group is saved as done as soon as it is posted to. If the service restarts part-way, the post resumes for the groups not yet posted to (up to 3 hours later) and never repeats the ones that already got it.
- On a deploy or stop signal, the service waits for a post in progress to finish (up to 30 minutes, change with `GRACEFUL_SHUTDOWN_MINUTES`) before exiting. Railway also has to allow this time: set the Railway variable `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` to something like `1800`, otherwise Railway may stop the old deployment sooner.
