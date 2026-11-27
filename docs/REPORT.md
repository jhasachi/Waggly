# Waggly — Report

**Scope:** testing, polish, performance review, security review, bug fixes, and documentation.

## Product state

Waggly is a responsive dog-grooming booking site with a calm, playful visual style. Customers can choose several services, enter pet and customer details without an account or email address, choose an available date and time, review the request, and submit it. The salon reviews pending requests in the staff dashboard and accepts or declines them. Accepted appointments can move through in-progress and completed states.

Appointments and service/availability settings persist in SQLite. Customers can open **My bookings** in the same browser to see current status. The browser stores a random 256-bit appointment access token; the server returns the current record using that token. The token is a bearer credential, so anyone with access to that browser profile or token can view the appointment. Clearing site data removes the saved browser list; it does not delete the server-side appointment.

Email integration, templates, verification, reminders, and notification delivery are intentionally omitted. Rescheduling and customer cancellation are also omitted. The staff dashboard remains protected by shared-password authentication.

## Implementation and polish

- Added an isolated Node.js functional test suite using `node:test`.
- Added `WAGGLY_DATA_DIR` to keep test data out of the working database.
- Added no-store responses for API and static content so status and updated booking UI are not served stale.
- Added response headers for MIME sniffing, framing, referrers, browser permissions, and a Content Security Policy compatible with the site's local scripts and Google Fonts.
- Limited JSON request bodies to 100 KB and return clear 400/413 responses for malformed or oversized input.
- Prevented production startup with the local demo staff password.
- Restricted customer appointment lookup URLs to the expected 64-character token format.
- Normalized optional text input and validated pet size on the server.
- Prioritized the homepage hero image and lazy-loaded the below-the-fold groomer image.
- Documented local setup, isolated test usage, browser-local booking access, and deployment cautions in the README.

The existing stylesheet includes responsive layouts at 1000 px, 760 px, and 420 px breakpoints. The two local photographs total approximately 852 KB; the hero image loads at high priority and the second image loads lazily.

## Files created

- `test/booking.test.js` — end-to-end HTTP coverage using a temporary server and SQLite database.
- `docs/REPORT.md` — this milestone report.
- `package-lock.json` — reproducible dependency versions.
- `storage.js` — SQLite storage, migration, transactional booking creation, and conflict handling (introduced in Milestone 3; included in the current uncommitted project changes).
- `public/my-bookings.html` and `public/my-bookings.js` — browser-local customer booking list (introduced with the no-email flow; included in the current uncommitted project changes).

## Test and review results

| Check                                    | Result                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm test`                               | 1 test passed; 0 failed.                                                                          |
| Booking request without an email address | Accepted and returned a pending booking.                                                          |
| Duplicate request key                    | Reused the original booking and token.                                                            |
| Overlapping appointment time             | Rejected with HTTP 409.                                                                           |
| Two-hour service reservation             | Blocked all overlapping 30-minute starts.                                                         |
| Staff API authentication                 | Protected booking list returned HTTP 401 before login.                                            |
| Staff workflow                           | Accept → confirmed → in progress → completed persisted. Decline reason persisted.                 |
| Appointment data after server restart    | Completed status remained available from SQLite.                                                  |
| Customer appointment response            | Returned booking details without exposing its token or an email field.                            |
| Malformed and oversized requests         | Returned HTTP 400 and 413, respectively.                                                          |
| Production password guard                | App refused to start with the demo password under `NODE_ENV=production`.                          |
| Security headers                         | No-store, nosniff, frame denial, and no-referrer headers checked.                                 |
| Dependency audit                         | `npm audit --omit=dev`: 0 vulnerabilities.                                                        |
| Syntax and patch hygiene                 | `node --check` on server/client scripts and `git diff --check` passed.                            |
| Responsive layout                        | Existing desktop/mobile breakpoints inspected in CSS; no automated visual-browser matrix was run. |

## Security notes and remaining limits

- Staff access uses one shared password. Set a unique `STAFF_PASSWORD` before sharing or hosting the app; the default `waggly-demo` is for local demonstrations. Add login rate limiting before exposing staff login publicly.
- Staff sessions are held in memory and are cleared when the process restarts. Use a persistent session store for a hosted deployment.
- Customer access tokens are stored in browser local storage to support account-free status tracking. Use HTTPS in any shared environment and keep the same-browser limitation clear to customers.
- The application binds to loopback by default. If hosted behind a reverse proxy, configure the bind address and TLS carefully.
- Functional coverage exercises the HTTP service and persistence, but does not replace manual visual checks on real desktop and mobile browsers.
