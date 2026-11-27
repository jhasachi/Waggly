const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const VALID_STATUSES = ['PENDING','CONFIRMED','ALTERNATIVE_PROPOSED','CANCELLATION_REQUESTED','RESCHEDULE_REQUESTED','REJECTED','CANCELLED','IN_PROGRESS','COMPLETED','EXPIRED'];
const ACTIVE_STATUSES = ['PENDING','CONFIRMED','IN_PROGRESS','COMPLETED'];
const CHECK_STATUS_SQL = VALID_STATUSES.map(s => `'${s}'`).join(',');

function minutes(time) {
  const [hour, minute] = String(time || '').split(':').map(Number);
  return hour * 60 + minute;
}

function occupiedTimes(booking) {
  if (!ACTIVE_STATUSES.includes(booking.status)) return [];
  const duration = Number(booking.duration) || 60;
  return booking.date && booking.time
    ? [{date:booking.date, start:minutes(booking.time), end:minutes(booking.time) + duration}]
    : [];
}

class StorageConflictError extends Error {
  constructor(message='That appointment time is no longer available.') {
    super(message);
    this.code = 'BOOKING_CONFLICT';
  }
}

class StorageVersionError extends Error {
  constructor() {
    super('This booking changed in another request. Refresh and try again.');
    this.code = 'BOOKING_VERSION_CONFLICT';
  }
}

class WagglyStorage {
  constructor({file, legacyFile, initialServices, hours}) {
    fs.mkdirSync(path.dirname(file), {recursive:true});
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.snapshots = new WeakMap();
    this.createSchema();
    this.seedOrMigrate({legacyFile, initialServices, hours});
  }

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        reference TEXT NOT NULL UNIQUE,
        token TEXT NOT NULL UNIQUE,
        idempotency_key TEXT UNIQUE,
        status TEXT NOT NULL CHECK (status IN (${CHECK_STATUS_SQL})),
        appointment_date TEXT NOT NULL,
        appointment_time TEXT NOT NULL,
        duration INTEGER NOT NULL CHECK (duration > 0),
        proposed_date TEXT,
        proposed_time TEXT,
        requested_date TEXT,
        requested_time TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS bookings_date_status ON bookings(appointment_date, status);
      CREATE TABLE IF NOT EXISTS blocked_slots (
        appointment_date TEXT NOT NULL,
        appointment_time TEXT NOT NULL,
        PRIMARY KEY (appointment_date, appointment_time)
      );
      CREATE TABLE IF NOT EXISTS settings (
        name TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
    `);
  }

  seedOrMigrate({legacyFile, initialServices, hours}) {
    let legacy = null;
    if (fs.existsSync(legacyFile)) {
      try { legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8')); }
      catch (error) { throw new Error(`Could not read the previous Waggly data file: ${error.message}`); }
    }
    const services = legacy?.services?.length ? legacy.services : initialServices;
    const tx = this.db.transaction(() => {
      const insertService = this.db.prepare('INSERT OR IGNORE INTO services(id,payload) VALUES(?,?)');
      for (const service of services) insertService.run(service.id, JSON.stringify(service));
      const insertBooking = this.db.prepare(`INSERT OR IGNORE INTO bookings
        (id,reference,token,status,appointment_date,appointment_time,duration,proposed_date,proposed_time,requested_date,requested_time,payload)
        VALUES(@id,@reference,@token,@status,@date,@time,@duration,@proposedDate,@proposedTime,@requestedDate,@requestedTime,@payload)`);
      for (const booking of legacy?.bookings || []) insertBooking.run(this.bookingRow(booking));
      const oldBookings = this.db.prepare("SELECT id,status,payload FROM bookings WHERE status IN ('ALTERNATIVE_PROPOSED','CANCELLATION_REQUESTED','RESCHEDULE_REQUESTED')").all();
      const updateBooking = this.db.prepare(`UPDATE bookings SET status=?,proposed_date=NULL,proposed_time=NULL,
        requested_date=NULL,requested_time=NULL,payload=?,version=version+1 WHERE id=?`);
      for (const row of oldBookings) {
        const booking = JSON.parse(row.payload);
        booking.status = row.status === 'CANCELLATION_REQUESTED' ? 'CANCELLED' : row.status === 'RESCHEDULE_REQUESTED' ? 'CONFIRMED' : 'PENDING';
        delete booking.proposedDate;
        delete booking.proposedTime;
        delete booking.requestedDate;
        delete booking.requestedTime;
        delete booking.previousStatus;
        updateBooking.run(booking.status, JSON.stringify(booking), row.id);
      }
      const putSetting = this.db.prepare('INSERT OR IGNORE INTO settings(name,payload) VALUES(?,?)');
      putSetting.run('hours', JSON.stringify(legacy?.hours || hours));
      putSetting.run('createdAt', JSON.stringify(legacy?.createdAt || new Date().toISOString()));
      const putSlot = this.db.prepare('INSERT OR IGNORE INTO blocked_slots(appointment_date,appointment_time) VALUES(?,?)');
      for (const value of legacy?.blockedSlots || []) {
        const [date, time] = value.split(' ');
        if (date && time) putSlot.run(date, time);
      }
    });
    tx.immediate();
  }

  bookingRow(booking) {
    return {
      id:booking.id, reference:booking.reference, token:booking.token,
      status:booking.status, date:booking.date, time:booking.time,
      duration:Number(booking.duration)||60,
      proposedDate:booking.proposedDate||null, proposedTime:booking.proposedTime||null,
      requestedDate:booking.requestedDate||null, requestedTime:booking.requestedTime||null,
      payload:JSON.stringify(booking)
    };
  }

  read() {
    const serviceRows = this.db.prepare('SELECT id,payload FROM services ORDER BY rowid').all();
    const bookingRows = this.db.prepare('SELECT id,payload,version FROM bookings ORDER BY rowid').all();
    const settings = Object.fromEntries(this.db.prepare('SELECT name,payload FROM settings').all().map(row => [row.name, JSON.parse(row.payload)]));
    const state = {
      services:serviceRows.map(row => JSON.parse(row.payload)),
      bookings:bookingRows.map(row => JSON.parse(row.payload)),
      blockedSlots:this.db.prepare('SELECT appointment_date,appointment_time FROM blocked_slots ORDER BY appointment_date,appointment_time').all().map(row => `${row.appointment_date} ${row.appointment_time}`),
      hours:settings.hours || {open:'09:00',close:'17:00',step:30},
      createdAt:settings.createdAt || new Date().toISOString()
    };
    this.snapshots.set(state, {
      services:new Map(serviceRows.map(row => [row.id, row.payload])),
      bookings:new Map(bookingRows.map(row => [row.id, {payload:row.payload,version:row.version}])),
      blockedSlots:new Set(state.blockedSlots),
      hours:JSON.stringify(state.hours)
    });
    return state;
  }

  assertBookingAvailable(booking, excludeId) {
    const candidateRanges = occupiedTimes(booking);
    const rows = this.db.prepare('SELECT id,payload FROM bookings').all();
    for (const row of rows) {
      if (row.id === excludeId) continue;
      const other = JSON.parse(row.payload);
      for (const a of candidateRanges) for (const b of occupiedTimes(other)) {
        if (a.date === b.date && a.start < b.end && a.end > b.start) throw new StorageConflictError();
      }
    }
    const step = JSON.parse(this.db.prepare("SELECT payload FROM settings WHERE name='hours'").get()?.payload || '{"step":30}').step || 30;
    for (const range of candidateRanges) {
      const blocked = this.db.prepare('SELECT appointment_time FROM blocked_slots WHERE appointment_date=?').all(range.date);
      if (blocked.some(row => range.start < minutes(row.appointment_time) + step && range.end > minutes(row.appointment_time))) throw new StorageConflictError('That time overlaps a slot the salon has closed.');
    }
  }

  createBooking(idempotencyKey, makeBooking) {
    const tx = this.db.transaction(() => {
      if (idempotencyKey) {
        const existing = this.db.prepare('SELECT payload FROM bookings WHERE idempotency_key=?').get(idempotencyKey);
        if (existing) return {booking:JSON.parse(existing.payload), duplicate:true};
      }
      const state = this.read();
      const booking = makeBooking(state);
      if (!booking) return {booking:null, duplicate:false};
      this.assertBookingAvailable(booking);
      const row = this.bookingRow(booking);
      this.db.prepare(`INSERT INTO bookings
        (id,reference,token,idempotency_key,status,appointment_date,appointment_time,duration,proposed_date,proposed_time,requested_date,requested_time,payload)
        VALUES(@id,@reference,@token,@idempotencyKey,@status,@date,@time,@duration,@proposedDate,@proposedTime,@requestedDate,@requestedTime,@payload)`)
        .run({...row,idempotencyKey:idempotencyKey||null});
      return {booking, duplicate:false};
    });
    return tx.immediate();
  }

  write(state) {
    const original = this.snapshots.get(state);
    if (!original) throw new Error('Database snapshot is missing; reload data before saving.');
    const tx = this.db.transaction(() => {
      const currentServices = new Map(state.services.map(service => [service.id, JSON.stringify(service)]));
      const putService = this.db.prepare(`INSERT INTO services(id,payload) VALUES(?,?)
        ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`);
      for (const [id, payload] of currentServices) if (original.services.get(id) !== payload) putService.run(id,payload);
      for (const id of original.services.keys()) if (!currentServices.has(id)) this.db.prepare('DELETE FROM services WHERE id=?').run(id);

      const currentBookings = new Map(state.bookings.map(booking => [booking.id, booking]));
      for (const [id, booking] of currentBookings) {
        const payload = JSON.stringify(booking), previous = original.bookings.get(id);
        if (previous?.payload === payload) continue;
        this.assertBookingAvailable(booking,id);
        const row = this.bookingRow(booking);
        if (!previous) {
          this.db.prepare(`INSERT INTO bookings
            (id,reference,token,status,appointment_date,appointment_time,duration,proposed_date,proposed_time,requested_date,requested_time,payload)
            VALUES(@id,@reference,@token,@status,@date,@time,@duration,@proposedDate,@proposedTime,@requestedDate,@requestedTime,@payload)`).run(row);
        } else {
          const result = this.db.prepare(`UPDATE bookings SET reference=@reference,token=@token,status=@status,
            appointment_date=@date,appointment_time=@time,duration=@duration,proposed_date=@proposedDate,
            proposed_time=@proposedTime,requested_date=@requestedDate,requested_time=@requestedTime,
            payload=@payload,version=version+1 WHERE id=@id AND version=@version`).run({...row,version:previous.version});
          if (result.changes !== 1) throw new StorageVersionError();
        }
      }
      for (const id of original.bookings.keys()) if (!currentBookings.has(id)) this.db.prepare('DELETE FROM bookings WHERE id=?').run(id);

      const desiredSlots = new Set(state.blockedSlots);
      for (const value of desiredSlots) if (!original.blockedSlots.has(value)) {
        const [date,time] = value.split(' ');
        this.db.prepare('INSERT INTO blocked_slots(appointment_date,appointment_time) VALUES(?,?)').run(date,time);
      }
      for (const value of original.blockedSlots) if (!desiredSlots.has(value)) {
        const [date,time] = value.split(' ');
        this.db.prepare('DELETE FROM blocked_slots WHERE appointment_date=? AND appointment_time=?').run(date,time);
      }
      const hours = JSON.stringify(state.hours);
      if (hours !== original.hours) this.db.prepare(`INSERT INTO settings(name,payload) VALUES('hours',?)
        ON CONFLICT(name) DO UPDATE SET payload=excluded.payload`).run(hours);
    });
    tx.immediate();
  }

  close() { this.db.close(); }
}

module.exports = {WagglyStorage, StorageConflictError, StorageVersionError};
