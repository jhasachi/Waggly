# Waggly Dog Grooming Studio

A small booking and appointment management app for a fictional independent dog groomer in Prague. It uses Node.js, plain HTML/CSS/JavaScript and a JSON file for persistent local storage. There is no customer account or payment flow.

## Run locally

Requirements: Node.js 20 or newer.

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) for the customer site, or [http://localhost:3000/staff](http://localhost:3000/staff) for the shared staff area. The local demo password is `waggly-demo`.

Booking and service records are saved to `data/waggly.json`, created on first run. The file is excluded from Git. Back it up before moving or removing the local data directory.

## Configuration

Set these environment variables before running outside a local demo:

| Variable | Purpose |
| --- | --- |
| `STAFF_PASSWORD` | Shared staff sign-in password. Replace the demo password. |
| `PORT` | HTTP port (defaults to `3000`). |
| `APP_URL` | Public base URL used in customer email links. |
| `STAFF_EMAIL` | Inbox for cancellation and reschedule notifications. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP connection for outgoing email. |
| `SMTP_SECURE` | Set `true` for implicit TLS (commonly port 465). |
| `MAIL_FROM` | Optional sender address (defaults to `SMTP_USER`). |

Without SMTP settings, email content is written to the server console so the full customer workflow can be previewed locally. The acknowledgement and decision emails are sent when SMTP is configured. Service prices and availability can be edited in the staff area; appointments use Europe/Prague local time, Monday through Saturday, with 30 minute starts. Service durations reserve overlapping time and pending requests hold their selected time until they are rejected, cancelled or completed.

## Included

- Responsive Waggly branded homepage, service catalogue, location/contact details and six step booking flow with multiple services per appointment.
- Server side validation, unique booking references, secure customer manage links, persistent bookings, and overlap checked availability.
- Customer requests for cancellation and rescheduling, including staff review; customer acceptance/decline of a proposed time.
- Staff session login, appointment review and status actions, service price/visibility management, and per-slot availability controls.
- Optional SMTP email delivery with a local console preview fallback.

This is a university prototype. For a public production launch, replace the JSON store with a transactional database and deploy behind HTTPS with managed secrets, backups and a persistent session store.

## Homepage photos

The hero and grooming photos were supplied by the user. The grooming image has been retouched to remove the branded sleeve patch while preserving the affectionate scene.
