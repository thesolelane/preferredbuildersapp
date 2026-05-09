'use strict';

const { google } = require('googleapis');

// ── Auth strategy ─────────────────────────────────────────────────────────────
// Production (Windows server): uses GOOGLE_SERVICE_ACCOUNT_JSON env var.
// Replit dev fallback: uses Replit connector OAuth tokens.
// If neither is available, all API calls are skipped gracefully.

let _serviceAccountClient = null;

function getServiceAccountClient() {
  if (_serviceAccountClient) return _serviceAccountClient;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  try {
    const key = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    _serviceAccountClient = google.calendar({ version: 'v3', auth });
    console.log('[GoogleCalendar] Using Service Account auth');
    return _serviceAccountClient;
  } catch (e) {
    console.warn('[GoogleCalendar] Service Account JSON parse failed:', e.message);
    return null;
  }
}

// ── Replit connector fallback ─────────────────────────────────────────────────

let _replitConnSettings = null;

async function getReplitConnectorClient() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const replIdentity = process.env.REPL_IDENTITY;
  const webReplRenewal = process.env.WEB_REPL_RENEWAL;
  const xReplitToken = replIdentity
    ? 'repl ' + replIdentity
    : webReplRenewal
      ? 'depl ' + webReplRenewal
      : null;

  if (!xReplitToken || !hostname) return null;

  // Reuse cached token if still valid
  if (
    _replitConnSettings?.settings?.expires_at &&
    new Date(_replitConnSettings.settings.expires_at).getTime() > Date.now()
  ) {
    const accessToken = _replitConnSettings.settings.access_token;
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  try {
    const data = await fetch(
      'https://' +
        hostname +
        '/api/v2/connection?include_secrets=true&connector_names=google-calendar',
      { headers: { Accept: 'application/json', 'X-Replit-Token': xReplitToken } },
    ).then((r) => r.json());

    _replitConnSettings = data.items?.[0];
    const accessToken =
      _replitConnSettings?.settings?.access_token ||
      _replitConnSettings?.settings?.oauth?.credentials?.access_token;

    if (!_replitConnSettings || !accessToken) return null;

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    return google.calendar({ version: 'v3', auth: oauth2Client });
  } catch {
    return null;
  }
}

async function getCalendarClient() {
  const sa = getServiceAccountClient();
  if (sa) return sa;

  const replit = await getReplitConnectorClient();
  if (replit) return replit;

  throw new Error('Google Calendar: no auth configured (set GOOGLE_SERVICE_ACCOUNT_JSON)');
}

// ── Attendees ─────────────────────────────────────────────────────────────────
// Always include OWNER_EMAIL + BOT_EMAIL (Jackson + bot account) plus any extras.

function buildAttendees(extraEmails = []) {
  const attendees = [];
  const seen = new Set();

  const addEmail = (email, status = 'needsAction') => {
    if (!email || seen.has(email)) return;
    seen.add(email);
    attendees.push({ email, responseStatus: status });
  };

  // Owner always gets accepted (primary calendar holder)
  const ownerEmail = process.env.OWNER_EMAIL;
  if (ownerEmail) addEmail(ownerEmail, 'accepted');

  // Bot/staff email (second account)
  const botEmail = process.env.BOT_EMAIL;
  if (botEmail) addEmail(botEmail, 'needsAction');

  // Also pull all active staff from the DB so no one gets missed
  try {
    const { getDb } = require('../db/database');
    const db = getDb();
    const staffEmails = db
      .prepare(`SELECT email FROM users WHERE active = 1 AND email IS NOT NULL`)
      .all()
      .map((u) => u.email);
    for (const email of staffEmails) addEmail(email, 'needsAction');
  } catch {
    // DB not ready yet — skip staff lookup
  }

  for (const email of extraEmails) addEmail(email, 'needsAction');

  return attendees;
}

// ── Calendar ID helper ────────────────────────────────────────────────────────
// For Service Account auth, 'primary' refers to the SA's own empty calendar.
// Use OWNER_EMAIL as calendarId so events land on Jackson's actual calendar
// (requires the calendar to be shared with the service account first).

function resolveCalendarId(calendarId) {
  if (calendarId && calendarId !== 'primary') return calendarId;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.OWNER_EMAIL) {
    return process.env.OWNER_EMAIL;
  }
  return calendarId || 'primary';
}

/**
 * Create a Google Calendar event for a task.
 * @param {object} task         - task row from DB (title, description, due_at)
 * @param {string} calendarId   - Google Calendar ID; auto-resolved if 'primary'
 * @param {string[]} extraEmails - additional attendees to invite
 * @returns {string|null}       - Google Calendar event HTML link or null on failure
 */
async function createCalendarEvent(task, calendarId = 'primary', extraEmails = []) {
  if (!task.due_at) return null;

  const resolvedId = resolveCalendarId(calendarId);
  const start = new Date(task.due_at);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const attendees = buildAttendees(extraEmails);

  // Reminder minutes: per-task override → per-job override → default 60
  const reminderMinutes = task.reminderMinutes || task.job_reminder_minutes || 60;

  const event = {
    summary: task.title,
    description: task.description || '',
    location: task.project_address || task.projectAddress || '',
    start: { dateTime: start.toISOString(), timeZone: 'America/New_York' },
    end: { dateTime: end.toISOString(), timeZone: 'America/New_York' },
    attendees: attendees.length ? attendees : undefined,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: reminderMinutes },
        { method: 'popup', minutes: 30 },
      ],
    },
  };

  try {
    const cal = await getCalendarClient();
    const result = await cal.events.insert({
      calendarId: resolvedId,
      resource: event,
      sendUpdates: attendees.length ? 'all' : 'none',
    });
    console.log(
      `[GoogleCalendar] Event created on calendar "${resolvedId}": ${result.data.htmlLink}`,
    );

    // Store the event ID back to the job if a jobId is provided
    if (task.job_id || task.jobId) {
      try {
        const { getDb } = require('../db/database');
        const db = getDb();
        db.prepare('UPDATE jobs SET calendar_event_id = ? WHERE id = ?').run(
          result.data.id,
          task.job_id || task.jobId,
        );
      } catch {
        /* non-fatal */
      }
    }

    return result.data.htmlLink || null;
  } catch (err) {
    console.warn('[GoogleCalendar] Failed to create event:', err.message);
    return null;
  }
}

/**
 * List upcoming events from the calendar (next 7 days).
 */
async function listUpcomingEvents(calendarId = 'primary', maxResults = 10) {
  const resolvedId = resolveCalendarId(calendarId);
  const cal = await getCalendarClient();
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const res = await cal.events.list({
    calendarId: resolvedId,
    timeMin: now.toISOString(),
    timeMax: week.toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  });
  return res.data.items || [];
}

/**
 * List all calendars accessible to this auth.
 */
async function listCalendars() {
  const cal = await getCalendarClient();
  const res = await cal.calendarList.list();
  return res.data.items || [];
}

/**
 * Check whether calendar integration is available.
 * Returns true if Service Account JSON is set OR Replit connector is present.
 */
async function isConfigured() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return true;
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const replIdentity = process.env.REPL_IDENTITY;
  return !!(hostname && replIdentity);
}

module.exports = { createCalendarEvent, listUpcomingEvents, listCalendars, isConfigured };
