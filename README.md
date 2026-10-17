# WhatsApp daily image poster

This service posts the image in a Google Drive folder whose name matches the current date at 8:00 AM and 10:00 PM in `Africa/Nairobi` by default. The same image is used for both posts, no caption is added, and the file is not deleted or moved. For example, the image for June 21, 2021 must be named `21st_june_2021.jpg` (any image extension is accepted).

## Configure

1. Create a Google service account with read-only access to the Drive API, then share the target folder with its service-account email.
2. Set the environment variables shown in `.env.example`. Store the full service-account JSON in `GOOGLE_SERVICE_ACCOUNT_JSON`; do not commit it or put it in a Docker image.
3. Run the service once and scan the WhatsApp QR code using the account authorized by the group admins. The WhatsApp session path must be on persistent storage. In each target group, send `!getid` or `getid!` and put the returned group ID(s) in `WHATSAPP_GROUP_IDS`, separated by commas.
4. Start the service with `npm start`. The process must remain running, and the host must preserve the configured WhatsApp session directory across restarts.

The service checks for exactly one image for today's date at each scheduled slot. It logs an error and skips that slot if no matching image exists or if multiple images match.

## Run and test

```sh
npm test
npm start
```

The included Dockerfile builds a container. A deploy target must provide an always-running process and persistent storage for `WHATSAPP_AUTH_PATH`; free hosting tiers may sleep, lose storage, or impose limits, so they cannot guarantee 24/7 delivery. Deployment also requires configuring secrets and completing the WhatsApp QR login on the chosen host.

This uses `whatsapp-web.js` (WhatsApp Web automation), not the official WhatsApp Business API. It may break when WhatsApp changes its web client and may carry account restriction risk. Only use it for groups whose admins have approved the scheduled posts.

## Credential hygiene

Never commit `.env`, Google service-account keys, or `.wwebjs_auth`. These artifacts were already present in the repository before this change; ignore rules do not remove files from existing Git history. Revoke and replace any exposed Google key, unlink/re-link the WhatsApp session if it was shared, and remove these artifacts from repository history before deploying or making the repository public.
