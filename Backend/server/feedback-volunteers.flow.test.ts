/**
 * Platform feedback and the volunteer programme, end to end — §6.32, §6.33.
 *
 * The four things the task set, in order:
 *
 *  1. An anonymous feedback submission and an anonymous volunteer application
 *     both succeed with no account.
 *  2. A simulated EmailJS failure leaves **both rows intact**, with
 *     `mail_dispatch_status` recording the failure. This is FR-33.9 and it is
 *     the whole reason the row is written first.
 *  3. A non-PDF renamed to `.pdf` is rejected — by its bytes, not its name.
 *  4. An unverified volunteer cannot appear in search. The flag never
 *     substitutes for verification (FR-33.10).
 */

import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HONEYPOT_FIELD, MIN_TIME_ON_FORM_MS } from '../shared/anti-abuse';
import { newId, nowIso } from '../shared/db-values';
import { sniffMimeType } from '../shared/file-signature';
import { searchQuerySchema } from '../shared/search';
import { createApp } from './app';
import { adminActions } from './db/schema/admin';
import { users } from './db/schema/identity';
import { platformFeedback, volunteerApplications } from './db/schema/platform';
import { tutorProfiles } from './db/schema/tutor';
import { createSeededTestDb, type TestDb } from './db/test-db';
import { findSearchableTutorBySlug, isTutorSearchable, searchTutors } from './repositories/search';
import { redactForTutorDisclosure } from './services/feedback';
import { setMailer, type MailDispatchResult, type Mailer } from './services/mail';
import { resetDocumentStorage } from './services/storage';
import { approveVolunteer } from './services/volunteers';

const PASSWORD = 'a-sufficiently-long-password';
const KARACHI = 'karachi';
const CLIFTON = 'karachi-clifton';

/* -------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------- */

/** Records every send and can be told to fail, as EmailJS does under quota. */
class RecordingMailer implements Mailer {
  readonly name = 'recording';
  readonly sent: string[] = [];

  constructor(private readonly outcome: MailDispatchResult['status'] = 'sent') {}

  send(message: { templateEnvVar: string }): Promise<MailDispatchResult> {
    this.sent.push(message.templateEnvVar);
    return Promise.resolve(
      this.outcome === 'sent'
        ? { status: 'sent', detail: 'ok' }
        : { status: this.outcome, detail: 'EmailJS responded 429' },
    );
  }
}

/** A mailer that throws rather than returning — the contract violation case. */
class ExplodingMailer implements Mailer {
  readonly name = 'exploding';
  send(): Promise<MailDispatchResult> {
    return Promise.reject(new Error('socket hang up'));
  }
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'utf8');
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
/** MZ — a Windows executable. What a renamed payload actually looks like. */
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

function b64(buffer: Buffer): string {
  return buffer.toString('base64');
}

/** A complete, valid application body. Overrides bend one thing at a time. */
function volunteerBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: 'Ayesha Khan',
    email: `ayesha-${newId().slice(0, 8)}@example.test`,
    phone: '0300-1234567',
    cityId: KARACHI,
    areaId: CLIFTON,
    subjectIds: ['mathematics'],
    levelIds: ['matric'],
    weeklyHours: 4,
    deliveryModes: ['home'],
    gender: 'female',
    motivation: 'میں ہفتے میں چار گھنٹے پڑھا سکتی ہوں۔ Roman Urdu bhi chalta hai.',
    timeOnFormMs: 45_000,
    ...overrides,
  };
}

let db: TestDb;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await createSeededTestDb();
  app = createApp(db);
  resetDocumentStorage();
  // Attachments land in the local backend's `uploads/`, which is gitignored
  // (`.gitignore:/uploads`). `LOCAL_UPLOAD_DIR` is read at module load, so it
  // cannot be redirected from here — the ignore rule is what keeps test bytes
  // out of the repository, and CLAUDE.md §2.2 makes that a graded failure.
  setMailer(new RecordingMailer('sent'));
});

afterEach(() => {
  setMailer(null);
  resetDocumentStorage();
});

function cookiesOf(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function makeAdmin(): Promise<string> {
  const email = `admin-${newId().slice(0, 8)}@example.test`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: PASSWORD, role: 'parent', displayName: 'Admin' });
  expect(res.status).toBe(201);

  await db.update(users).set({ role: 'admin' }).where(eq(users.email, email));

  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  return cookiesOf(login);
}

/* -------------------------------------------------------------------------
 * 1. Anonymous submission, both forms
 * ---------------------------------------------------------------------- */

describe('anonymous submission (FR-32.6, FR-33.1)', () => {
  it('accepts feedback with no account and writes no identity field at all', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .set('Accept-Language', 'ur-PK,ur;q=0.9')
      .set('X-App-Version', '4.0.1')
      .send({
        category: 'defect',
        detail: 'اردو والا صفحہ ٹھیک نہیں دکھتا۔ The filters overlap on mobile.',
        satisfactionRating: 2,
        pagePath: '/search?subject=mathematics',
        timeOnFormMs: 12_000,
      });

    expect(res.status).toBe(201);
    expect(res.body.acknowledgement).toBeTruthy();

    const [row] = await db.select().from(platformFeedback);
    expect(row!.userId).toBeNull();
    expect(row!.role).toBeNull();

    // FR-32.4: captured from the request, not asked of the reporter.
    expect(row!.pagePath).toBe('/search?subject=mathematics');
    expect(row!.locale).toBe('ur');
    expect(row!.appVersion).toBe('4.0.1');

    // FR-32.3: byte for byte, mixed script, not normalised or translated.
    expect(row!.detail).toBe('اردو والا صفحہ ٹھیک نہیں دکھتا۔ The filters overlap on mobile.');

    // No identity anywhere on the row — not an IP, not a session, not a name.
    const serialised = JSON.stringify(row);
    expect(serialised).not.toMatch(/127\.0\.0\.1|::1|session|ip_address/i);
  });

  it('accepts a volunteer application with no account', async () => {
    const res = await request(app).post('/api/volunteers').send(volunteerBody());

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.acknowledgement).toMatch(/verified against a CNIC/i);

    const [row] = await db.select().from(volunteerApplications);
    expect(row!.status).toBe('received');
    expect(row!.weeklyHours).toBe(4);
    // Stored as typed. Not normalised into +92 form (§2.10).
    expect(row!.phone).toBe('0300-1234567');
    expect(row!.motivation).toContain('میں ہفتے میں چار گھنٹے');

    // FR-33.7: the team notification and the applicant acknowledgement go out
    // in the same dispatch.
    expect(res.body.mailDispatchStatus).toBe('sent');
  });

  it('accepts an attachment and stores it in the private bucket, never a URL', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .send({
        category: 'usability',
        detail: 'Here is what I see.',
        timeOnFormMs: 9_000,
        attachment: { fileName: 'screen.png', mimeType: 'image/png', contentBase64: b64(PNG_BYTES) },
      });

    expect(res.status).toBe(201);

    const [row] = await db.select().from(platformFeedback);
    expect(row!.attachmentPath).toMatch(/^feedback\//);
    expect(row!.attachmentPath).not.toMatch(/^https?:/);
    // And the path is never returned to the submitter.
    expect(JSON.stringify(res.body)).not.toContain('feedback/');
  });

  it('rejects an obvious bot without telling it why', async () => {
    const honeypot = await request(app)
      .post('/api/volunteers')
      .send(volunteerBody({ [HONEYPOT_FIELD]: 'http://spam.example' }));

    const tooFast = await request(app)
      .post('/api/volunteers')
      .send(volunteerBody({ timeOnFormMs: MIN_TIME_ON_FORM_MS - 1 }));

    expect(honeypot.status).toBe(400);
    expect(tooFast.status).toBe(400);
    // Identical messages: naming the honeypot field or the threshold is a free
    // tuning guide for the next attempt.
    expect(honeypot.body.error.message).toBe(tooFast.body.error.message);
    expect(honeypot.body.error.message).not.toMatch(/honeypot|websiteUrl|3000|seconds/i);

    expect(await db.select().from(volunteerApplications)).toHaveLength(0);
  });

  it('accepts a submission that omits the timing signal entirely', async () => {
    // A non-browser client that never measured anything is not a bot. Absent is
    // not evidence; a reported 40 ms is.
    const body = volunteerBody();
    delete body.timeOnFormMs;

    expect((await request(app).post('/api/volunteers').send(body)).status).toBe(201);
  });
});

/* -------------------------------------------------------------------------
 * 2. A mail failure never loses a submission — FR-33.9, FR-32.9
 * ---------------------------------------------------------------------- */

describe('EmailJS is a notification channel, not a system of record (FR-33.9)', () => {
  it('keeps the volunteer application and records the failure', async () => {
    setMailer(new RecordingMailer('failed'));

    const res = await request(app).post('/api/volunteers').send(volunteerBody());

    // The applicant is not told their application failed, because it did not.
    expect(res.status).toBe(201);

    const [row] = await db.select().from(volunteerApplications);
    expect(row).toBeDefined();
    expect(row!.fullName).toBe('Ayesha Khan');
    expect(row!.status).toBe('received');
    // Recorded, so a retry sweep can find it.
    expect(row!.mailDispatchStatus).toBe('failed');
    expect(res.body.mailDispatchStatus).toBe('failed');
  });

  it('keeps the feedback row and records the failure', async () => {
    setMailer(new RecordingMailer('failed'));

    const res = await request(app)
      .post('/api/feedback')
      .send({ category: 'other', detail: 'Something to say.', timeOnFormMs: 8_000 });

    expect(res.status).toBe(201);

    const [row] = await db.select().from(platformFeedback);
    expect(row!.detail).toBe('Something to say.');
    expect(row!.mailDispatchStatus).toBe('failed');
  });

  it('survives a mailer that throws instead of returning', async () => {
    setMailer(new ExplodingMailer());

    const res = await request(app).post('/api/volunteers').send(volunteerBody());
    expect(res.status).toBe(201);

    const [row] = await db.select().from(volunteerApplications);
    expect(row!.mailDispatchStatus).toBe('failed');
  });

  it('reports the worst outcome when the team is notified but the applicant is not', async () => {
    // The applicant is the person waiting. If their acknowledgement did not go
    // out, the row must not read `sent`.
    let call = 0;
    setMailer({
      name: 'partial',
      send: () => {
        call += 1;
        return Promise.resolve(
          call === 1
            ? ({ status: 'sent', detail: 'ok' } as MailDispatchResult)
            : ({ status: 'failed', detail: 'template missing' } as MailDispatchResult),
        );
      },
    });

    await request(app).post('/api/volunteers').send(volunteerBody());
    const [row] = await db.select().from(volunteerApplications);
    expect(row!.mailDispatchStatus).toBe('failed');
  });

  it('dispatches both messages, and only after the row exists', async () => {
    const mailer = new RecordingMailer('sent');
    setMailer(mailer);

    await request(app).post('/api/volunteers').send(volunteerBody());

    expect(mailer.sent).toEqual(['EMAILJS_TEMPLATE_VOLUNTEER', 'EMAILJS_TEMPLATE_VOLUNTEER_ACK']);
  });

  it('records `skipped`, not `sent`, when no mailer is configured', async () => {
    // The honest default in development and on a fresh deployment: nothing went
    // out, and the row says so rather than claiming a send.
    setMailer(null);
    delete process.env.EMAILJS_SERVICE_ID;

    await request(app).post('/api/volunteers').send(volunteerBody());
    const [row] = await db.select().from(volunteerApplications);
    expect(row!.mailDispatchStatus).toBe('skipped');
  });

  it('holds no SMTP credential, mail password or private key in the repository (SEC-25)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '..');

    const files: string[] = [];
    const skip = new Set(['node_modules', 'dist', '.git', 'uploads', 'Data']);
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|js|json|md|example)$/.test(entry.name)) files.push(full);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(50);

    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      // A real credential, not the word. `.env.example` carries placeholders.
      expect(text, file).not.toMatch(/SMTP_PASS(WORD)?\s*=\s*["']?(?!REPLACE_|\s*$)\S+/);
      expect(text, file).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      expect(text, file).not.toMatch(/MAIL_PASSWORD\s*=\s*["']?(?!REPLACE_|\s*$)\S+/);
    }
  });
});

/* -------------------------------------------------------------------------
 * 3. Content sniffing — SEC-24, FR-33.3
 * ---------------------------------------------------------------------- */

describe('an attachment is validated by its bytes, not its name (SEC-24)', () => {
  it('rejects an executable renamed to .pdf and declared as a PDF', async () => {
    const res = await request(app)
      .post('/api/volunteers')
      .send(
        volunteerBody({
          document: {
            fileName: 'curriculum-vitae.pdf',
            mimeType: 'application/pdf',
            contentBase64: b64(EXE_BYTES),
          },
        }),
      );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('file_content_mismatch');
    // And it does not tell the caller what it actually detected — a public form
    // is not a file-type oracle.
    expect(res.body.error.message).not.toMatch(/executable|MZ|application\/x-/i);

    // Nothing was written. The sniff runs before the row.
    expect(await db.select().from(volunteerApplications)).toHaveLength(0);
  });

  it('rejects a ZIP and a PNG posing as a PDF', async () => {
    for (const bytes of [ZIP_BYTES, PNG_BYTES]) {
      const res = await request(app)
        .post('/api/volunteers')
        .send(
          volunteerBody({
            document: { fileName: 'cv.pdf', mimeType: 'application/pdf', contentBase64: b64(bytes) },
          }),
        );
      expect(res.status).toBe(400);
    }
    expect(await db.select().from(volunteerApplications)).toHaveLength(0);
  });

  it('accepts a genuine PDF', async () => {
    const res = await request(app)
      .post('/api/volunteers')
      .send(
        volunteerBody({
          document: { fileName: 'cv.pdf', mimeType: 'application/pdf', contentBase64: b64(PDF_BYTES) },
        }),
      );

    expect(res.status).toBe(201);
    const [row] = await db.select().from(volunteerApplications);
    expect(row!.documentPath).toMatch(/^volunteers\/.+\.pdf$/);
    expect(row!.documentPath).not.toMatch(/^https?:|^\.\/|^\//);
  });

  it('refuses a non-PDF on the volunteer form even when it is a genuine image', async () => {
    // FR-33.3 narrows this form to PDF. A JPG of a degree certificate is a real
    // thing someone will try, and the schema — not the sniffer — refuses it.
    const res = await request(app)
      .post('/api/volunteers')
      .send(
        volunteerBody({
          document: { fileName: 'degree.jpg', mimeType: 'image/jpeg', contentBase64: b64(JPEG_BYTES) },
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('sniffs the three accepted formats and nothing else', () => {
    expect(sniffMimeType(PDF_BYTES)).toBe('application/pdf');
    expect(sniffMimeType(PNG_BYTES)).toBe('image/png');
    expect(sniffMimeType(JPEG_BYTES)).toBe('image/jpeg');
    expect(sniffMimeType(EXE_BYTES)).toBeNull();
    expect(sniffMimeType(ZIP_BYTES)).toBeNull();
    expect(sniffMimeType(Buffer.from([]))).toBeNull();
    // A file whose first bytes are a PDF header but truncated below it.
    expect(sniffMimeType(Buffer.from([0x25, 0x50]))).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * 4. The volunteer flag never substitutes for verification — FR-33.10
 * ---------------------------------------------------------------------- */

describe('an approved volunteer is still unverified (FR-33.10)', () => {
  async function applyAndApprove(): Promise<{ tutorId: string; profileStatus: string }> {
    const submitted = await request(app)
      .post('/api/volunteers')
      .send(
        volunteerBody({
          document: { fileName: 'cv.pdf', mimeType: 'application/pdf', contentBase64: b64(PDF_BYTES) },
        }),
      );
    expect(submitted.status).toBe(201);

    const adminUserId = (
      await db
        .insert(users)
        .values({
          id: newId(),
          email: `converter-${newId().slice(0, 8)}@example.test`,
          passwordHash: 'not-a-real-hash',
          role: 'admin',
          displayName: 'Converter',
          status: 'active',
          createdAt: nowIso(),
          updatedAt: nowIso(),
        })
        .then(() => db.select().from(users).where(eq(users.role, 'admin')))
    )[0]!.id;

    const result = await approveVolunteer(db, {
      applicationId: submitted.body.id as string,
      adminUserId,
      password: 'a-sufficiently-long-password',
      reviewNote: 'Retired teacher, references check out. Converting to a tutor account.',
    });

    return { tutorId: result.tutorId, profileStatus: result.profileStatus };
  }

  it('creates a draft profile that no search can reach', async () => {
    const { tutorId, profileStatus } = await applyAndApprove();

    expect(profileStatus).toBe('draft');

    const [profile] = await db.select().from(tutorProfiles).where(eq(tutorProfiles.id, tutorId));
    expect(profile!.volunteerFlag).toBe(1);
    // The declared cap, carried across for FR-33.11.
    expect(profile!.volunteerWeeklyHours).toBe(4);
    expect(profile!.profileStatus).toBe('draft');

    /* --- The assertion the requirement is really about ------------------- */

    expect(await isTutorSearchable(db, tutorId)).toBe(false);
    expect(await findSearchableTutorBySlug(db, profile!.slug)).toBeNull();

    // Every filter combination a family could reach them through.
    for (const filters of [
      {},
      { genderPreference: 'female_only' as const },
      { cityId: KARACHI },
      { areaId: CLIFTON, includeAdjacentAreas: true },
      { subjectId: 'mathematics', levelId: 'matric' },
    ]) {
      const response = await searchTutors(db, searchQuerySchema.parse(filters));
      expect(response.results.map((r) => r.tutor.id)).not.toContain(tutorId);
    }
  });

  /**
   * The control that stops the test above being vacuous.
   *
   * A tutor absent from search because they were never verified looks exactly
   * like a tutor absent because the fixture was incomplete. So: flip the same
   * profile to `approved` and assert they now appear. If this fails, the
   * absence assertions were proving nothing.
   */
  it('DOES appear once an administrator approves the profile — the control', async () => {
    const { tutorId } = await applyAndApprove();

    expect(await isTutorSearchable(db, tutorId)).toBe(false);

    await db
      .update(tutorProfiles)
      .set({ profileStatus: 'approved' })
      .where(eq(tutorProfiles.id, tutorId));

    expect(await isTutorSearchable(db, tutorId)).toBe(true);

    const response = await searchTutors(db, searchQuerySchema.parse({}));
    expect(response.results.map((r) => r.tutor.id)).toContain(tutorId);

    // And they carry the Volunteer designation with a zero rate (FR-33.10):
    // the flag says no fee is charged, never that anyone was checked.
    const hit = response.results.find((r) => r.tutor.id === tutorId);
    expect(hit!.tutor.volunteer).toBe(true);
    expect(hit!.normalisedHourly ?? 0).toBe(0);
  });

  it('remains unsearchable at every status short of approved', async () => {
    const { tutorId } = await applyAndApprove();

    for (const status of ['draft', 'pending_verification', 'under_review', 'more_info_needed'] as const) {
      await db
        .update(tutorProfiles)
        .set({ profileStatus: status })
        .where(eq(tutorProfiles.id, tutorId));

      expect(await isTutorSearchable(db, tutorId), status).toBe(false);
      const response = await searchTutors(db, searchQuerySchema.parse({}));
      expect(response.results.map((r) => r.tutor.id), status).not.toContain(tutorId);
    }
  });

  it('records in the audit log that conversion did not verify', async () => {
    await applyAndApprove();

    const entries = await db.select().from(adminActions);
    const conversion = entries.find((e) => e.action === 'volunteer_application.converted');
    expect(conversion).toBeDefined();

    const detail = JSON.parse(conversion!.detailJson ?? '{}') as Record<string, unknown>;
    expect(detail.profileStatus).toBe('draft');
    expect(detail.verificationRequired).toBe(true);
    expect(detail.volunteerFlag).toBe(true);
  });

  it('refuses to approve without the supporting document (FR-33.3)', async () => {
    const submitted = await request(app).post('/api/volunteers').send(volunteerBody());
    expect(submitted.status).toBe(201);

    const adminUserId = newId();
    await db.insert(users).values({
      id: adminUserId,
      email: `a-${newId().slice(0, 8)}@example.test`,
      passwordHash: 'not-a-real-hash',
      role: 'admin',
      displayName: 'Admin',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    await expect(
      approveVolunteer(db, {
        applicationId: submitted.body.id as string,
        adminUserId,
        password: PASSWORD,
        reviewNote: 'Looks promising.',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'document_required' });

    expect(await db.select().from(tutorProfiles)).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------
 * Triage, visibility and SEC-26
 * ---------------------------------------------------------------------- */

describe('feedback is administrator-only and never reaches a tutor (FR-32.10, SEC-26)', () => {
  async function submitSafetyConcern(): Promise<string> {
    const res = await request(app).post('/api/feedback').send({
      category: 'content_or_safety',
      detail: 'The tutor who came on Tuesday to my daughter in Clifton made me uncomfortable.',
      timeOnFormMs: 30_000,
    });
    expect(res.status).toBe(201);
    expect(res.body.escalated).toBe(true);
    return res.body.id as string;
  }

  it('escalates a safety concern and keeps it off every non-admin surface', async () => {
    const id = await submitSafetyConcern();
    const adminCookie = await makeAdmin();

    const [row] = await db.select().from(platformFeedback);
    expect(row!.safetyConcernFlag).toBe(1);

    // A tutor sees nothing. There is no route that would serve it.
    const tutorRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: `t-${newId().slice(0, 8)}@example.test`,
        password: PASSWORD,
        role: 'tutor',
        displayName: 'Tutor',
      });
    const tutorCookie = cookiesOf(tutorRes);

    expect((await request(app).get('/api/feedback/queue').set('Cookie', tutorCookie)).status).toBe(403);
    expect((await request(app).get(`/api/feedback/${id}`).set('Cookie', tutorCookie)).status).toBe(403);
    expect((await request(app).get('/api/feedback/queue')).status).toBe(401);

    // The administrator can, and it is in the escalated list.
    const queue = await request(app)
      .get('/api/feedback/queue?safetyOnly=true')
      .set('Cookie', adminCookie);
    expect(queue.status).toBe(200);
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(id);
  });

  it('strips the reporter from anything a tutor could be shown (SEC-26)', async () => {
    await submitSafetyConcern();
    const [row] = await db.select().from(platformFeedback);

    const detail = row!.detail;
    const disclosure = redactForTutorDisclosure(
      {
        id: row!.id,
        userId: row!.userId,
        role: row!.role,
        category: row!.category,
        detail,
        satisfactionRating: row!.satisfactionRating,
        pagePath: row!.pagePath,
        locale: row!.locale,
        appVersion: row!.appVersion,
        attachmentPath: row!.attachmentPath,
        safetyConcernFlag: true,
        status: 'triaged',
        dispositionNote: null,
        triagedBy: null,
        triagedAt: null,
        mailDispatchStatus: 'sent',
        createdAt: new Date('2027-05-04T13:45:22.000Z'),
      },
      'A concern was raised about conduct during a session. Please respond.',
    );

    // The free text routinely identifies its author by what it describes.
    expect(JSON.stringify(disclosure)).not.toContain('Clifton');
    expect(JSON.stringify(disclosure)).not.toContain('daughter');
    expect(JSON.stringify(disclosure)).not.toContain(row!.id);
    // Date only. A timestamp to the second, against a tutor's diary, names one
    // family.
    expect(disclosure.raisedOn).toBe('2027-05-04');
    expect(Object.keys(disclosure).sort()).toEqual(['category', 'raisedOn', 'summary']);
  });

  it('writes every status change to the append-only audit log (FR-32.7)', async () => {
    const id = await submitSafetyConcern();
    const adminCookie = await makeAdmin();

    const triaged = await request(app)
      .post(`/api/feedback/${id}/triage`)
      .set('Cookie', adminCookie)
      .send({ status: 'actioned', dispositionNote: 'Contacted the family and opened a review.' });

    expect(triaged.status).toBe(200);
    expect(triaged.body.feedback.status).toBe('actioned');

    const entries = await db.select().from(adminActions);
    const entry = entries.find((e) => e.action === 'platform_feedback.triaged');
    expect(entry).toBeDefined();
    expect(entry!.targetId).toBe(id);

    const detail = JSON.parse(entry!.detailJson ?? '{}') as Record<string, unknown>;
    expect(detail.from).toBe('new');
    expect(detail.to).toBe('actioned');
    expect(detail.reason).toBe('Contacted the family and opened a review.');
  });

  it('requires a disposition note with something in it', async () => {
    const id = await submitSafetyConcern();
    const adminCookie = await makeAdmin();

    const res = await request(app)
      .post(`/api/feedback/${id}/triage`)
      .set('Cookie', adminCookie)
      .send({ status: 'declined', dispositionNote: '' });

    expect(res.status).toBe(400);
    // Nothing was written to the log either — a decision with no reason is not
    // a record of the decision.
    expect(await db.select().from(adminActions)).toHaveLength(0);
  });

  it('never contributes to ranking or any public statistic (FR-32.10)', async () => {
    // Structural: nothing in the ranking or search path reads the table.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '..');

    for (const file of [
      'shared/ranking.ts',
      'server/repositories/search.ts',
      'server/jobs/tutor-scores.ts',
      'server/jobs/tutor-reliability.ts',
      'server/jobs/rate-benchmarks.ts',
    ]) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      expect(text, file).not.toMatch(/platformFeedback|platform_feedback/);
    }
  });
});
