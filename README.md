# WhatsApp morning and evening image poster

This service runs continuously on Railway and posts **images with a caption** to approved WhatsApp groups, Monday to Saturday, until the last post day (default `2026-12-05`, inclusive; change it with `LAST_POST_DATE`). Nothing is posted on Sundays or after that date. Times are in `Africa/Nairobi` by default (`SCHEDULE_TIMEZONE`).

| Rule | Value |
|---|---|
| Morning posts | 2 per day, random times between 5:00 and 7:30 AM, image `MORNING.png` |
| Evening posts | 2 per day, random times between 5:00 and 8:00 PM, image `EVENING.png` |
| Saturday afternoon post | 1 on Saturdays only, random time between 12:00 and 16:00, welcome-back wording (6 messages), image `AFTERNOON.png` if present in Drive, otherwise text only |
| ODOI post | Follows **every** post (morning, evening and Saturday afternoon), in the same group, about a minute later (random 45-100 s lag), so 4 per weekday and 5 on Saturdays |
| Minimum gap between two posts in the same window | 1 hour |
| Several groups | 20-90 s random pause between groups |

The images are read from the configured Google Drive folder and are strictly named `MORNING.png`, `EVENING.png`, `ODOI.png` and (optional) `AFTERNOON.png`. If one is missing, that post is skipped. The day's plan is saved to `daily-plan.json` next to the WhatsApp session, so a restart or redeploy resumes it instead of creating extra posts. A post more than 30 minutes late (for example after an outage) is skipped. If the service starts late in the day, it plans only the rest of the day.

## ODOI post

`ODOI.png` is posted in each group right after that group's morning, afternoon or evening post, after a random lag of 45-100 seconds, with a fixed caption from `lib/content.js` (`ODOI_CAPTION`): no greeting, no signature, no rotation. The lag is random so it is not an identical gap every time. If `ODOI.png` is missing or cannot be downloaded, the regular post is still sent alone. `!status` shows `image + ODOI` for these posts.

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

**Add a group without typing a command in it:** open `https://YOUR-APP.up.railway.app/manage?token=YOUR_TOKEN`. It lists every group the account is in, with its name and ID, and an Add / Remove button for each. Nothing is sent to any group.

**Add a group with a word:** send exactly `YHWH` (any case) inside a group. It adds the group, replies privately in your own chat, and deletes the message from the group. Only your own account is obeyed. To use a different word, set `ADD_GROUP_WORD` in Railway (one word, 4+ characters).

### Keeping groups across deploys

Groups are saved next to the WhatsApp login in `WHATSAPP_AUTH_PATH`. That folder **must be on a Railway volume**, otherwise every deploy wipes it (`!status` and `/manage` show a warning when it looks like it is not). For a guarantee that does not depend on the volume, `/groups` and `!groups` print a ready-made line `WHATSAPP_GROUP_IDS=...`; paste it into the Railway variables and those groups are always included.

### Control links (more reliable than commands)

Set `ADMIN_TOKEN` in Railway to a private value of 12+ characters, then open these on your phone (replace the domain):

- `https://YOUR-APP.up.railway.app/status?token=YOUR_TOKEN`
- `.../pause?token=...` and `.../resume?token=...`
- `.../groups?token=...` lists the groups
- `.../addgroup?token=...&id=123456789-111@g.us` and `.../removegroup?token=...&id=...`

Anyone with the link can control the bot, so keep the token private. Without `ADMIN_TOKEN` these links do not exist.

## Groups that cannot be posted to

Before each post the bot checks every group. A group is skipped (and the others still get the post) when the account was removed from it, it no longer exists, or only admins can post and the account is not an admin. Skipped groups appear in `!status` and are re-checked automatically (every 20 minutes at most).

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
