# WhatsApp weekday image and message poster

This service runs continuously on Railway and plans each day's posts in `Africa/Nairobi` by default (`SCHEDULE_TIMEZONE`). Post times are **not fixed**: every day gets a new random plan.

| Rule | Value |
|---|---|
| Image posts (Mon–Fri) | 2–3 per day, each with a different caption |
| Message posts (Mon–Fri) | 1–2 per day, different wording each time |
| Posting window | 6:00 AM – 9:30 PM |
| Minimum gap between any two posts | 1 hour |
| Conference countdown | daily, random time 7:30–10:00 AM, 26 Oct – 14 Nov 2026 only |
| Several groups | 20–90 s random pause between groups |

The day's plan is saved to `daily-plan.json` next to the WhatsApp session, so a restart or redeploy resumes it instead of creating extra posts. A post that is more than 30 minutes late (for example after an outage) is skipped. If the service starts late in the day, it plans only the rest of the day and may post less.

Images use `MONDAY.png` … `FRIDAY.png` from the configured Google Drive folder. If the current weekday's image is missing, that post is skipped. Images and messages are not sent on Saturday or Sunday; the countdown is.

## Pause and resume without redeploying

On the linked phone, open your own "Message yourself" chat (any one-to-one chat of yours also works) and send:

| Command | Effect |
|---|---|
| `!pause` | Stops all posting. Posts planned while paused are skipped, not queued. |
| `!resume` | Posting continues with the rest of today's plan. |
| `!status` | Replies with paused/active, WhatsApp status, the last result and today's plan. |

The pause state is saved on the volume, so it survives restarts. `!getid` still works inside a group, but only when sent from the linked account. The `/health` endpoint also shows `paused` and `lastResult`.

### Pause from a link (more reliable than commands)

Set `ADMIN_TOKEN` in Railway to a private value of 12+ characters, then open these on your phone (replace the domain with your Railway one):

- `https://YOUR-APP.up.railway.app/pause?token=YOUR_TOKEN`
- `https://YOUR-APP.up.railway.app/resume?token=YOUR_TOKEN`
- `https://YOUR-APP.up.railway.app/status?token=YOUR_TOKEN`

This works even if WhatsApp does not deliver your command messages. Anyone with the link can pause the bot, so keep the token private. Without `ADMIN_TOKEN` these links do not exist.

## Groups that cannot be posted to

Before each post the bot checks every group. A group is skipped (and the other groups still get the post) when the account was removed from it, it no longer exists, or only admins can post and the account is not an admin. A failed send to one group never stops the rest. Skipped groups appear in `!status` / `/status` and are re-checked automatically (every 20 minutes at most), so they resume by themselves once the account can post again.

## Captions and messages

All wording lives in `lib/content.js`. Captions are built from 10 openers × 10 closers (100 variants, `{Day}` becomes the weekday name) and messages from 12 leads × 6 tails × 2 layouts (144 variants), each containing the bold `*ALEX FOR GUILD*`. The rotation walks through all of them before repeating, so nothing repeats for at least 30 days. Edit the lists freely; `npm test` checks that the pools are still big enough. Review the default wording before deploying.

## Configure

1. Create a Google service account with read-only access to the Drive API and share the weekday image folder with its service-account email.
2. Set the environment variables shown in `.env.example` in Railway. Store the full service-account JSON in `GOOGLE_SERVICE_ACCOUNT_JSON`; never commit it or put it in a Docker image.
3. Set `WHATSAPP_PHONE_NUMBER` to the linked account's international-format number (country code and digits only). The service uses phone-number pairing rather than QR codes. In the Railway logs, copy the pairing code, then on the authorized phone open **WhatsApp → Linked devices → Link a device → Link with phone number instead** and enter the code.
4. In each approved target group, send `!getid` or `getid!` from the linked WhatsApp account. Set the returned group IDs, comma-separated, in `WHATSAPP_GROUP_IDS`.
5. Keep the Railway service running and attach a persistent volume. Set `WHATSAPP_AUTH_PATH` to a directory on that volume (for example, `/data/baileys_auth`) so restarts can reuse the WhatsApp session.

## Deploy on Railway

Use this repository's `Dockerfile` as the Railway builder and add the required variables from `.env.example` in Railway's service settings. Keep the service on an always-running plan; a sleeping or stopped service cannot run its scheduled posts. The `/health` endpoint reports service and WhatsApp connection status.

Use Railway's deployment logs to confirm that WhatsApp connects and the weekday schedules start. If WhatsApp disconnects, the service retries most disconnects automatically. A logged-out session needs to be paired again. Disable any other deployment that could post the same messages to avoid duplicates.

## Run and test locally

```sh
npm test
npm start
```

This uses Baileys, an unofficial WhatsApp Web protocol library, not the official WhatsApp Business API. Only use it for groups whose admins have approved the scheduled posts. The protocol may change, and automated messaging may carry account restriction risk.

## Credential hygiene

Never commit `.env`, Google service-account keys, or `.baileys_auth`. Ignore rules do not remove previously committed files from Git history. Revoke and replace any exposed Google key, unlink/re-link the WhatsApp session if it was shared, and remove exposed artifacts from repository history before deploying or making the repository public.
