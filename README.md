# Waggly

A small booking and appointment management app for a fictional independent dog groomer in Prague. It uses Node.js, SQLite, and plain HTML/CSS/JavaScript. There is no customer account or payment flow.

## Run locally

Requirements: Node.js 20 or newer.

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) for the customer site, or [http://localhost:3000/staff](http://localhost:3000/staff) for the shared staff area. The local demo password is `waggly-demo`.

Run `npm test` for the isolated booking and staff workflow suite. Tests use a temporary SQLite directory and an ephemeral local port; they do not modify `data/waggly.sqlite`.

Booking, service, availability, and status records are stored in `data/waggly.sqlite`, created on first run. If a previous `data/waggly.json` exists, the app imports its services, bookings, hours, and blocked slots at startup. The database is excluded from Git; back it up before moving or removing the local data directory.

## Configuration

Set these environment variables before running outside a local demo:

| Variable                                           | Purpose                                                   |
| -------------------------------------------------- | --------------------------------------------------------- |
| `STAFF_PASSWORD`                                   | Shared staff sign-in password. Replace the demo password. |
| `PORT`                                             | HTTP port (defaults to `3000`).                           |
| `HOST`                                             | Bind address (defaults to loopback, `127.0.0.1`).          |
| `WAGGLY_DATA_DIR`                                   | Optional data directory override, primarily for testing.   |

Service prices and availability can be edited in the staff area; appointments use Europe/Prague local time, Monday through Saturday, with 30 minute starts. Service durations reserve overlapping time and pending requests hold their selected time until staff accept or decline them. Customers can review appointment details and see status updates from the My bookings page on the same browser. Booking access tokens are stored in browser local storage; clearing site data removes the local list.

The app sends no email and asks customers for no email address. Staff decisions update the saved appointment status, which customers can see by reopening My bookings in the same browser. Set a unique `STAFF_PASSWORD` for any shared or hosted environment; the demo password is intended only for local use. The app includes basic response security headers and caps JSON request bodies at 100 KB.

## Included

- Responsive Waggly branded homepage, service catalogue, location/contact details and six step booking flow with multiple services per appointment.
- Transactional SQLite persistence, unique booking references, secure customer manage links, idempotent booking submissions, and overlap checked availability.
- Browser-local customer booking list and secure appointment review; staff accept or decline booking requests.
- Staff session login, appointment review and status actions, service price/visibility management, and per-slot availability controls.
- Automated tests for booking validation without email, idempotency, overlapping availability, staff authentication and status changes, and persistence after restart.

This is a university prototype. For a public production launch, deploy behind HTTPS with managed secrets, regular database backups, a persistent session store, and a trusted reverse proxy if binding beyond loopback. See [the Milestone 7 report](docs/MILESTONE-7-REPORT.md) for test and security review details.
