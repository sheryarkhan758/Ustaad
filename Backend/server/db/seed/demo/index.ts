/**
 * The demonstration seed — §6.15, FR-15.8.
 *
 *     npm run db:seed:demo
 *
 * Produces a database a stranger can explore in ninety seconds: 25 tutors
 * across five cities in every verification state, families whose children hold
 * no accounts, bookings through every lifecycle state, reviews whose
 * credibility signals actually differ, payments in each status including a
 * dispute under resolution, feedback and volunteer applications, and five
 * recorded agent sessions that replay with **zero live model calls**.
 * The materialisation jobs run last, so no derived statistic is empty.
 *
 * ── Two refusals, deliberately ─────────────────────────────────────────────
 *  1. **It will not run against Postgres.** `SUPABASE_DB_URL` being set means
 *     the configured database is production. Synthetic people with published
 *     passwords must never be written there, and a flag that says "I meant it"
 *     is exactly the flag someone sets at 2 a.m. So there is no flag.
 *  2. **It clears demonstration data before writing.** Re-running must be
 *     idempotent or the second run collides on `users.email` and leaves the
 *     database half-populated. Reference data is left alone — this seed layers
 *     on top of `npm run db:seed`, it does not replace it.
 *
 * Every person, review, biography and message in this dataset is invented.
 */

import 'dotenv/config';

import { createHash } from 'node:crypto';

import { eq, inArray, like, or } from 'drizzle-orm';

import { newId, nowIso, toDbBool, toDbJson } from '../../../../shared/db-values';
import { normaliseHourlyAmount } from '../../../../shared/rates';
import { hashPassword } from '../../../services/auth';
import { runAllMaterialisationJobs } from '../../../jobs/index';
import type { Executor } from '../../../repositories/_base';
import { adminActions, flags, orgProfiles, vacancies, vacancyInterests } from '../../schema/admin';
import { agentSessions, diagnostics, studyPlans } from '../../schema/ai';
import { bookings, sessionNotes, trialFitChecks } from '../../schema/booking';
import { reviews, reviewAnalyses } from '../../schema/feedback';
import { parentProfiles, studentProfiles, users } from '../../schema/identity';
import { groupMembers, groupProposals, groupRequests, unmetDemand } from '../../schema/matching';
import { paymentDisputes, paymentRecords } from '../../schema/payment';
import { platformFeedback, volunteerApplications } from '../../schema/platform';
import {
  tutorAvailability,
  tutorProfiles,
  tutorRates,
  tutorSafetyConstraints,
  tutorSubjectClaims,
} from '../../schema/tutor';
import { verificationAppeals, verificationRecords } from '../../schema/verification';
import {
  DEMO_ADMIN,
  DEMO_ADULT_STUDENT,
  DEMO_ORGANISATION,
  DEMO_PARENTS,
  DEMO_PASSWORD,
  DEMO_TUTORS,
} from './people';
import { DEMO_AGENT_SESSIONS } from './agent-sessions';
import { DEMO_REVIEWS } from './reviews';

/** Everything this seed writes carries an address in this domain. */
const DEMO_EMAIL_SUFFIX = '%@demo.ustaad.test';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function isoDate(now: Date, offsetDays: number): string {
  return new Date(now.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export interface DemoSeedResult {
  tutors: number;
  parents: number;
  students: number;
  bookings: number;
  reviews: number;
  payments: number;
  agentSessions: number;
  jobs: { scores: number; reliability: number; benchmarks: number };
}

/**
 * A stable id for a demonstration account, derived from its email.
 *
 * Re-seeding must reuse the **same** `users.id`, and the reason is worth
 * stating because it caught this seed out once already:
 *
 * `admin_actions.admin_user_id` references `users(id)` and the log is
 * append-only (§2.7, NFR-19). A second run that deleted the demonstration
 * administrator would leave audit entries pointing at a row that no longer
 * exists — so SQLite refuses the delete, and it is right to. **The audit log
 * pins the people it names.** That is the control working: you cannot make an
 * administrator's recorded decisions ownerless by removing the administrator.
 *
 * So demonstration users are never deleted. Their ids are a function of their
 * email, their child data is cleared and rewritten, and the audit trail from
 * every previous run stays valid and keeps accumulating.
 */
function demoUserId(email: string): string {
  const hex = createHash('sha256').update(`ustaad-demo:${email}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    // Version 8 (custom), variant 10xx — a well-formed UUID rather than a hash
    // that merely looks like one.
    `8${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Remove everything a previous demo run wrote **except the user rows**, so
 * re-seeding is idempotent.
 *
 * Deletes are explicitly ordered rather than left to cascades, because the
 * cascades that would do this work hang off `users`, and `users` is exactly
 * what must survive (see `demoUserId`). Each step below removes the children
 * that would otherwise block the next.
 *
 * `admin_actions` is never cleared, for the same reason: a log you can empty by
 * re-running a script is not an audit log.
 */
async function clearPreviousDemoData(db: Executor): Promise<void> {
  const demoUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, DEMO_EMAIL_SUFFIX));
  const ids = demoUsers.map((row) => row.id);

  await db.delete(agentSessions).where(eq(agentSessions.isDemoSeed, 1));
  await db.delete(volunteerApplications).where(like(volunteerApplications.email, DEMO_EMAIL_SUFFIX));
  await db.delete(unmetDemand);

  if (ids.length === 0) return;

  const tutorRows = await db
    .select({ id: tutorProfiles.id })
    .from(tutorProfiles)
    .where(inArray(tutorProfiles.userId, ids));
  const tutorProfileIds = tutorRows.map((row) => row.id);

  const studentRows = await db
    .select({ id: studentProfiles.id })
    .from(studentProfiles)
    .where(or(inArray(studentProfiles.parentUserId, ids), inArray(studentProfiles.selfUserId, ids)));
  const studentProfileIds = studentRows.map((row) => row.id);

  // Bookings first: session notes, fit checks and payment records hang off them.
  if (studentProfileIds.length > 0) {
    await db.delete(bookings).where(inArray(bookings.studentProfileId, studentProfileIds));
    await db.delete(groupMembers).where(inArray(groupMembers.studentProfileId, studentProfileIds));
    await db.delete(groupRequests).where(inArray(groupRequests.studentProfileId, studentProfileIds));
  }
  if (tutorProfileIds.length > 0) {
    await db.delete(bookings).where(inArray(bookings.tutorId, tutorProfileIds));
    await db.delete(groupProposals).where(inArray(groupProposals.tutorId, tutorProfileIds));
    await db.delete(vacancyInterests).where(inArray(vacancyInterests.tutorId, tutorProfileIds));
  }

  if (studentProfileIds.length > 0) {
    await db.delete(studentProfiles).where(inArray(studentProfiles.id, studentProfileIds));
  }

  // Verification records reference the administrator, but cascade from the
  // tutor profile — so they go with it and the audit entries about them remain.
  if (tutorProfileIds.length > 0) {
    await db.delete(tutorProfiles).where(inArray(tutorProfiles.id, tutorProfileIds));
  }

  const orgRows = await db
    .select({ id: orgProfiles.id })
    .from(orgProfiles)
    .where(inArray(orgProfiles.userId, ids));
  if (orgRows.length > 0) {
    await db.delete(vacancies).where(inArray(vacancies.orgId, orgRows.map((row) => row.id)));
    await db.delete(orgProfiles).where(inArray(orgProfiles.id, orgRows.map((row) => row.id)));
  }

  // `flags.target_id` is polymorphic and therefore not a foreign key, so
  // nothing cascades these away. They are found by their reporter instead, or
  // they would duplicate on every re-seed.
  await db.delete(flags).where(inArray(flags.reporterUserId, ids));

  await db.delete(parentProfiles).where(inArray(parentProfiles.userId, ids));
  // Feedback nulls its user rather than cascading, so it would otherwise
  // survive as an orphan attributed to nobody.
  await db.delete(platformFeedback).where(inArray(platformFeedback.userId, ids));
}

/**
 * Write the account if it is new, refresh it if a previous run created it.
 *
 * Never a delete-and-reinsert, so the id stays stable and the audit trail keeps
 * pointing at a row that exists.
 */
async function upsertDemoUser(
  db: Executor,
  row: {
    email: string;
    passwordHash: string;
    role: 'admin' | 'organisation' | 'tutor' | 'parent' | 'student';
    displayName: string;
    gender?: 'female' | 'male' | null;
    preferredLang?: 'en' | 'ur';
    createdAt: string;
  },
): Promise<string> {
  // Matched on **email**, not on the derived id. `users.email` is the unique
  // column, so it is the only key that reliably finds a row a previous run
  // wrote — including a run from before ids were derived, which would otherwise
  // collide on the unique index and take the whole seed down.
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, row.email))
    .limit(1);

  const shared = {
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role,
    displayName: row.displayName,
    gender: row.gender ?? null,
    preferredLang: row.preferredLang ?? ('en' as const),
    status: 'active' as const,
    updatedAt: nowIso(),
  };

  if (existing[0]) {
    // Keep whatever id that row already has: the audit log may reference it.
    await db.update(users).set(shared).where(eq(users.id, existing[0].id));
    return existing[0].id;
  }

  const id = demoUserId(row.email);
  await db.insert(users).values({ id, ...shared, createdAt: row.createdAt });
  return id;
}

export async function seedDemoData(db: Executor, now: Date = new Date()): Promise<DemoSeedResult> {
  await clearPreviousDemoData(db);

  // One hash, computed once. bcrypt at cost 12 takes ~250 ms; doing it per
  // account would add half a minute to a script whose whole promise is speed.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  /* --- Staff and organisation ---------------------------------------- */

  const adminUserId = await upsertDemoUser(db, {
    email: DEMO_ADMIN.email,
    passwordHash,
    role: 'admin',
    displayName: DEMO_ADMIN.displayName,
    createdAt: daysAgo(now, 500),
  });

  const orgUserId = await upsertDemoUser(db, {
    email: DEMO_ORGANISATION.email,
    passwordHash,
    role: 'organisation',
    displayName: DEMO_ORGANISATION.displayName,
    createdAt: daysAgo(now, 120),
  });
  const orgProfileId = newId();
  await db.insert(orgProfiles).values({
    id: orgProfileId,
    userId: orgUserId,
    orgName: DEMO_ORGANISATION.orgName,
    orgType: DEMO_ORGANISATION.orgType,
    description: DEMO_ORGANISATION.description,
    website: null,
    cityId: DEMO_ORGANISATION.cityId,
    areaId: DEMO_ORGANISATION.areaId,
    contactEmail: DEMO_ORGANISATION.contactEmail,
    contactPhone: DEMO_ORGANISATION.contactPhone,
    approvedAt: daysAgo(now, 110),
    approvedBy: adminUserId,
    createdAt: daysAgo(now, 120),
  });

  /* --- Tutors --------------------------------------------------------- */

  /** slug → ids, so bookings and reviews can refer to a tutor by name. */
  const tutorIds = new Map<string, { profileId: string; userId: string }>();

  for (const spec of DEMO_TUTORS) {
    const userId = await upsertDemoUser(db, {
      email: `${spec.slug}@demo.ustaad.test`,
      passwordHash,
      role: 'tutor',
      displayName: spec.displayName,
      gender: spec.gender,
      preferredLang: spec.bioUr ? 'ur' : 'en',
      createdAt: daysAgo(now, 400),
    });
    const profileId = newId();
    tutorIds.set(spec.slug, { profileId, userId });

    await db.insert(tutorProfiles).values({
      id: profileId,
      userId,
      gender: spec.gender,
      cityId: spec.cityId,
      bio: spec.bio,
      bioUr: spec.bioUr ?? null,
      qualifications: spec.qualifications,
      experienceYears: spec.experienceYears,
      teachesAtHome: toDbBool(spec.teachesAtHome),
      teachesOnline: toDbBool(spec.teachesOnline),
      teachesAtOwnPlace: toDbBool(spec.teachesAtOwnPlace),
      willingAreasJson: toDbJson(spec.areas)!,
      volunteerFlag: toDbBool(Boolean(spec.volunteer)),
      volunteerWeeklyHours: spec.volunteer?.weeklyHours ?? null,
      profileStatus: spec.profileStatus,
      slug: spec.slug,
      createdAt: daysAgo(now, 400),
    });

    /* Identity verification — attributed, reasoned and audited (FR-6.6). */
    if (spec.identity) {
      const recordId = newId();
      await db.insert(verificationRecords).values({
        id: recordId,
        tutorId: profileId,
        track: 'identity',
        decision: spec.identity.decision,
        artefactsCheckedJson: toDbJson(spec.identity.artefacts)!,
        decidedBy: adminUserId,
        decidedAt: daysAgo(now, spec.identity.daysAgo),
        reason: spec.identity.reason,
        createdAt: daysAgo(now, spec.identity.daysAgo),
      });

      await db.insert(adminActions).values({
        id: newId(),
        adminUserId,
        action: `tutor.identity_${spec.identity.decision}`,
        targetType: 'tutor_profile',
        targetId: profileId,
        detailJson: toDbJson({
          artefactsChecked: spec.identity.artefacts,
          reason: spec.identity.reason,
        }),
        createdAt: daysAgo(now, spec.identity.daysAgo),
      });

      // An automated or administrative verdict affecting a livelihood is never
      // final without a route to human review (SEC-18, decision 12).
      if (spec.identity.appeals) {
        await db.insert(verificationAppeals).values({
          id: newId(),
          tutorId: profileId,
          track: 'identity',
          againstRecordId: recordId,
          claimId: null,
          tutorReason: spec.identity.appeals.reason,
          eligibleFrom: daysAgo(now, spec.identity.daysAgo - 7),
          status: spec.identity.appeals.outcome,
          decidedBy: null,
          decisionReason: null,
          decidedAt: null,
          createdAt: daysAgo(now, Math.max(1, spec.identity.daysAgo - 10)),
        });
      }
    }

    for (const claim of spec.claims) {
      await db.insert(tutorSubjectClaims).values({
        id: newId(),
        tutorId: profileId,
        subjectId: claim.subjectId,
        levelId: claim.levelId,
        boardId: claim.boardId,
        topicIdsJson: toDbJson(claim.topicIds)!,
        claimStatus: claim.status,
        verifiedAt: claim.status === 'verified' ? daysAgo(now, 40) : null,
        expiresOn: claim.expiresInDays === undefined ? null : isoDate(now, claim.expiresInDays),
        createdAt: daysAgo(now, 200),
      });
    }

    for (const rate of spec.rates) {
      await db.insert(tutorRates).values({
        id: newId(),
        tutorId: profileId,
        subjectId: rate.subjectId ?? null,
        levelId: rate.levelId ?? null,
        rateType: rate.rateType,
        amount: rate.amount,
        currency: 'PKR',
        sessionsPerWeek: rate.sessionsPerWeek ?? null,
        minutesPerSession: rate.minutesPerSession ?? null,
        mode: rate.mode,
        groupSizeMax: rate.groupSizeMax ?? null,
        perHeadAmount: rate.perHeadAmount ?? null,
        negotiable: toDbBool(rate.negotiable ?? false),
        travelCharge: rate.travelCharge ?? 0,
        // Normalised through the shared converter, never by hand — the whole
        // point of `shared/rates.ts` is that one function owns the arithmetic.
        normalisedHourlyAmount: normaliseHourlyAmount({
          rateType: rate.rateType,
          amount: rate.amount,
          sessionsPerWeek: rate.sessionsPerWeek ?? null,
          minutesPerSession: rate.minutesPerSession ?? null,
          groupSizeMax: rate.groupSizeMax ?? null,
          perHeadAmount: rate.perHeadAmount ?? null,
        }),
        createdAt: daysAgo(now, 200),
      });
    }

    if (spec.safety) {
      await db.insert(tutorSafetyConstraints).values({
        id: newId(),
        tutorId: profileId,
        femaleStudentsOnly: toDbBool(spec.safety.femaleStudentsOnly ?? false),
        guardianPresenceRequired: toDbBool(spec.safety.guardianPresenceRequired ?? false),
        restrictedAreaIdsJson: toDbJson(spec.safety.restrictedAreaIds ?? [])!,
        updatedAt: nowIso(),
      });
    }

    // Weekday-evening availability, so slot generation has something to work
    // from on every approved tutor.
    if (spec.profileStatus === 'approved') {
      for (const weekday of [1, 3, 5]) {
        await db.insert(tutorAvailability).values({
          id: newId(),
          tutorId: profileId,
          weekday,
          startTime: '16:00',
          endTime: '20:00',
          mode: spec.teachesAtHome ? 'home' : spec.teachesOnline ? 'online' : 'own_place',
          areaId: null,
          createdAt: daysAgo(now, 200),
        });
      }
    }
  }

  /* --- Families ------------------------------------------------------- */

  const parentIds = new Map<string, string>();
  const studentIds = new Map<string, string>();
  let studentCount = 0;

  for (const parent of DEMO_PARENTS) {
    const userId = await upsertDemoUser(db, {
      email: parent.email,
      passwordHash,
      role: 'parent',
      displayName: parent.displayName,
      createdAt: daysAgo(now, 300),
    });
    parentIds.set(parent.key, userId);

    await db.insert(parentProfiles).values({
      id: newId(),
      userId,
      cityId: parent.cityId,
      areaId: parent.areaId,
      // Deliberately null. SEC-3 puts the residential address on a confirmed
      // booking, encrypted, readable by the two parties — not on a profile.
      addressEncrypted: null,
      createdAt: daysAgo(now, 300),
    });

    for (const student of parent.students) {
      const studentProfileId = newId();
      studentIds.set(student.key, studentProfileId);
      studentCount += 1;

      // A minor: owned by the parent account, with no `users` row and no
      // credential anywhere (SEC-1, §2.3).
      await db.insert(studentProfiles).values({
        id: studentProfileId,
        parentUserId: userId,
        selfUserId: null,
        name: student.name,
        levelId: student.levelId,
        boardId: student.boardId,
        schoolName: student.school ?? null,
        dateOfBirth: student.dateOfBirth,
        createdAt: daysAgo(now, 300),
      });
    }
  }

  /* The one learner old enough to hold an account. */
  const adultStudentUserId = await upsertDemoUser(db, {
    email: DEMO_ADULT_STUDENT.email,
    passwordHash,
    role: 'student',
    displayName: DEMO_ADULT_STUDENT.displayName,
    gender: 'female',
    createdAt: daysAgo(now, 90),
  });
  const adultStudentProfileId = newId();
  await db.insert(studentProfiles).values({
    id: adultStudentProfileId,
    parentUserId: null,
    selfUserId: adultStudentUserId,
    name: DEMO_ADULT_STUDENT.displayName,
    levelId: DEMO_ADULT_STUDENT.levelId,
    boardId: DEMO_ADULT_STUDENT.boardId,
    dateOfBirth: DEMO_ADULT_STUDENT.dateOfBirth,
    createdAt: daysAgo(now, 90),
  });
  studentIds.set('adult', adultStudentProfileId);
  studentCount += 1;

  /* --- Bookings, in every lifecycle state ----------------------------- */

  const bookingCount = await seedBookings({
    db,
    now,
    tutorIds,
    parentIds,
    studentIds,
    adultStudentUserId,
  });

  /* --- Reviews, payments, group, platform data ------------------------ */

  const reviewCount = await seedReviews({ db, now, tutorIds, parentIds });
  const paymentCount = await seedPayments({ db, now, adminUserId });
  await seedGroup({ db, now, tutorIds, studentIds });
  await seedPlatformData({
    db,
    now,
    parentIds,
    adminUserId,
    flaggedTutorId: tutorIds.get('hina-rehman')!.profileId,
  });
  await seedVacancy({ db, now, orgProfileId, tutorIds });
  await seedUnmetDemand(db, now);

  /* --- Recorded agent sessions — zero live calls on replay (FR-15.7) -- */

  for (const session of DEMO_AGENT_SESSIONS) {
    const sessionId = newId();
    await db.insert(agentSessions).values({
      id: sessionId,
      type: session.type,
      userId: null,
      studentProfileId: null,
      goal: session.goal,
      transcriptJson: toDbJson(session.transcript)!,
      // The scratchpad carries the scenario's presentation metadata as well as
      // the replay script, so `server/routes/demo.ts` can serve the panel from
      // the database alone and never imports this seed file. The demonstration
      // is then a property of the data, not of a hard-coded list in a handler.
      scratchpadJson: toDbJson({
        replayScript: session.replayScript,
        replayIndex: 0,
        demoKey: session.key,
        title: session.title,
        summary: session.summary,
        requirement: session.requirement,
        exhibit: session.exhibit ?? null,
      })!,
      status: session.status,
      turnCount: session.transcript.filter((t) => t.role !== 'agent').length,
      model: session.model,
      promptVersion: session.promptVersion,
      isDemoSeed: 1,
      createdAt: daysAgo(now, 5),
      completedAt: daysAgo(now, 5),
    });

    if (session.diagnostic) {
      const diagnosticId = newId();

      await db.insert(diagnostics).values({
        id: diagnosticId,
        agentSessionId: sessionId,
        studentProfileId: studentIds.get('zara') ?? null,
        subjectId: session.diagnostic.subjectId,
        gapMapJson: toDbJson(session.diagnostic.gapMap)!,
        insufficientInfoJson: toDbJson([])!,
        matchedTutorIdsJson: toDbJson(
          session.diagnostic.matchedSlugs
            .map((slug) => tutorIds.get(slug)?.profileId)
            .filter((id): id is string => Boolean(id)),
        )!,
        createdAt: daysAgo(now, 5),
      });

      /*
       * A study plan over the same chain, so §6.25's countdown and §6.26's
       * timeline have something to render on a fresh clone. Without one the
       * only way to see either screen is to spend a model call generating a
       * plan, which is exactly what the demonstration path exists to avoid.
       *
       * The dates are computed here the way `server/ai/study-plan.ts`
       * computes them — a week per step from the start date — because
       * FR-26.4 puts all date arithmetic in code and a seed that hard-coded
       * different dates would be modelling something the generator never
       * produces. `prereqValidated` is 1: the ordering below *is* the
       * prerequisite chain, root first.
       */
      const planStart = daysAgo(now, 14);
      const planSteps = session.diagnostic.gapMap.gaps.map((gap, index) => {
        const from = new Date(planStart).getTime() + index * 7 * 86_400_000;
        return {
          topicId: gap.topicId,
          weekOffset: index,
          focus: gap.rationale ?? '',
          startDate: new Date(from).toISOString().slice(0, 10),
          endDate: new Date(from + 6 * 86_400_000).toISOString().slice(0, 10),
        };
      });

      if (planSteps.length > 0) {
        await db.insert(studyPlans).values({
          id: newId(),
          diagnosticId,
          studentProfileId: studentIds.get('zara') ?? null,
          levelId: 'matric',
          // Six weeks out, so the countdown shows a live figure rather than a
          // date that has already passed by the time anyone opens it.
          targetDate: new Date(new Date(planStart).getTime() + 42 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          planJson: toDbJson({
            steps: planSteps,
            summary:
              'Six weeks, working upward from the root gap. Each topic is only ' +
              'attempted once the one it depends on has been covered.',
          })!,
          prereqValidated: 1,
          model: session.model,
          promptVersion: 'study-plan.v1',
          createdAt: daysAgo(now, 5),
        });
      }
    }
  }

  /* --- Materialisation, so no derived statistic is empty -------------- */

  const jobs = await runAllMaterialisationJobs(db, now);

  return {
    tutors: DEMO_TUTORS.length,
    parents: DEMO_PARENTS.length,
    students: studentCount,
    bookings: bookingCount,
    reviews: reviewCount,
    payments: paymentCount,
    agentSessions: DEMO_AGENT_SESSIONS.length,
    jobs: {
      scores: jobs.scores.tutors,
      reliability: jobs.reliability.written,
      benchmarks: jobs.benchmarks.published,
    },
  };
}

/* =========================================================================
 * Bookings — every state in `BOOKING_STATUSES`, plus notes and fit checks
 * ====================================================================== */

interface BookingContext {
  db: Executor;
  now: Date;
  tutorIds: Map<string, { profileId: string; userId: string }>;
  parentIds: Map<string, string>;
  studentIds: Map<string, string>;
  adultStudentUserId: string;
}

/** Ids the later seeders need to attach reviews and payments to. */
export const DEMO_BOOKING_KEYS = {
  completedMonthly: 'completed-monthly',
  completedMonthly2: 'completed-monthly-2',
  completedTrial: 'completed-trial',
  completedSingle: 'completed-single',
  completedForSafety: 'completed-safety-review',
  confirmed: 'confirmed',
  inProgress: 'in-progress',
  requested: 'requested',
  declined: 'declined',
  cancelled: 'cancelled',
  noShow: 'no-show',
} as const;

/** Populated by `seedBookings`, read by `seedReviews` and `seedPayments`. */
const bookingRegistry = new Map<string, { id: string; tutorId: string; parentUserId: string }>();

async function seedBookings(ctx: BookingContext): Promise<number> {
  const { db, tutorIds, parentIds, studentIds } = ctx;

  const ayesha = tutorIds.get('ayesha-siddiqui')!;
  const fatima = tutorIds.get('fatima-noor')!;
  const hina = tutorIds.get('hina-rehman')!;
  const sana = tutorIds.get('sana-tariq')!;
  const nadia = tutorIds.get('nadia-hussain')!;

  const asma = parentIds.get('parent-karachi')!;
  const nasreen = parentIds.get('parent-karachi-2')!;
  const rukhsar = parentIds.get('parent-karachi-3')!;

  const zara = studentIds.get('zara')!;
  const omar = studentIds.get('omar')!;
  const hamza = studentIds.get('hamza')!;
  const ali = studentIds.get('ali')!;
  const adult = studentIds.get('adult')!;

  interface Row {
    key: string;
    tutor: { profileId: string };
    studentProfileId: string;
    requestedByUserId: string;
    engagementType: 'monthly' | 'single_session' | 'short_term_package' | 'group';
    status: 'requested' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'declined' | 'no_show';
    subjectId: string;
    levelId: string;
    boardId: string;
    areaId: string;
    mode: 'home' | 'online' | 'own_place';
    requestedDaysAgo: number;
    isTrial?: boolean;
    sessionPurpose?: 'concept_clarification' | 'exam_revision' | 'doubt_solving' | 'assessment_review';
    packageSessionsTotal?: number;
    guardianPresenceRequired?: boolean;
  }

  const rows: Row[] = [
    {
      key: DEMO_BOOKING_KEYS.completedMonthly,
      tutor: ayesha, studentProfileId: zara, requestedByUserId: asma,
      engagementType: 'monthly', status: 'completed',
      subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board',
      areaId: 'karachi-clifton', mode: 'home', requestedDaysAgo: 120, guardianPresenceRequired: true,
    },
    {
      key: DEMO_BOOKING_KEYS.completedMonthly2,
      tutor: fatima, studentProfileId: hamza, requestedByUserId: nasreen,
      engagementType: 'monthly', status: 'completed',
      subjectId: 'physics', levelId: 'intermediate', boardId: 'sindh-board',
      areaId: 'karachi-gulshan-e-iqbal', mode: 'home', requestedDaysAgo: 95, guardianPresenceRequired: true,
    },
    {
      // A trial, so the private fit check has something to attach to (SEC-15).
      key: DEMO_BOOKING_KEYS.completedTrial,
      tutor: hina, studentProfileId: ali, requestedByUserId: rukhsar,
      engagementType: 'single_session', status: 'completed', isTrial: true,
      sessionPurpose: 'concept_clarification',
      subjectId: 'chemistry', levelId: 'matric', boardId: 'sindh-board',
      areaId: 'karachi-dha', mode: 'home', requestedDaysAgo: 30, guardianPresenceRequired: true,
    },
    {
      key: DEMO_BOOKING_KEYS.completedSingle,
      tutor: sana, studentProfileId: adult, requestedByUserId: ctx.adultStudentUserId,
      engagementType: 'single_session', status: 'completed',
      sessionPurpose: 'exam_revision',
      subjectId: 'english', levelId: 'undergraduate', boardId: 'university',
      areaId: 'karachi-pechs', mode: 'online', requestedDaysAgo: 20,
    },
    {
      key: DEMO_BOOKING_KEYS.completedForSafety,
      tutor: nadia, studentProfileId: omar, requestedByUserId: asma,
      engagementType: 'monthly', status: 'completed',
      subjectId: 'mathematics', levelId: 'middle', boardId: 'sindh-board',
      areaId: 'karachi-clifton', mode: 'home', requestedDaysAgo: 60, guardianPresenceRequired: true,
    },
    {
      key: DEMO_BOOKING_KEYS.confirmed,
      tutor: ayesha, studentProfileId: omar, requestedByUserId: asma,
      engagementType: 'monthly', status: 'confirmed',
      subjectId: 'mathematics', levelId: 'middle', boardId: 'sindh-board',
      areaId: 'karachi-clifton', mode: 'home', requestedDaysAgo: 10, guardianPresenceRequired: true,
    },
    {
      key: DEMO_BOOKING_KEYS.inProgress,
      tutor: fatima, studentProfileId: zara, requestedByUserId: asma,
      engagementType: 'monthly', status: 'in_progress',
      subjectId: 'physics', levelId: 'matric', boardId: 'sindh-board',
      areaId: 'karachi-clifton', mode: 'home', requestedDaysAgo: 45, guardianPresenceRequired: true,
    },
    {
      key: DEMO_BOOKING_KEYS.requested,
      tutor: hina, studentProfileId: hamza, requestedByUserId: nasreen,
      engagementType: 'short_term_package', status: 'requested', packageSessionsTotal: 8,
      subjectId: 'chemistry', levelId: 'intermediate', boardId: 'sindh-board',
      areaId: 'karachi-gulshan-e-iqbal', mode: 'home', requestedDaysAgo: 2,
    },
    {
      key: DEMO_BOOKING_KEYS.declined,
      tutor: ayesha, studentProfileId: ali, requestedByUserId: rukhsar,
      engagementType: 'monthly', status: 'declined',
      subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board',
      areaId: 'karachi-dha', mode: 'home', requestedDaysAgo: 15,
    },
    {
      key: DEMO_BOOKING_KEYS.cancelled,
      tutor: sana, studentProfileId: zara, requestedByUserId: asma,
      engagementType: 'single_session', status: 'cancelled',
      sessionPurpose: 'doubt_solving',
      subjectId: 'english', levelId: 'matric', boardId: 'sindh-board',
      areaId: 'karachi-clifton', mode: 'online', requestedDaysAgo: 8,
    },
    {
      key: DEMO_BOOKING_KEYS.noShow,
      tutor: nadia, studentProfileId: ali, requestedByUserId: rukhsar,
      engagementType: 'single_session', status: 'no_show',
      sessionPurpose: 'assessment_review',
      subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board',
      areaId: 'karachi-dha', mode: 'home', requestedDaysAgo: 25,
    },
  ];

  for (const row of rows) {
    const id = newId();
    const terminal = ['completed', 'cancelled', 'declined', 'no_show'].includes(row.status);

    await db.insert(bookings).values({
      id,
      tutorId: row.tutor.profileId,
      studentProfileId: row.studentProfileId,
      requestedByUserId: row.requestedByUserId,
      engagementType: row.engagementType,
      sessionPurpose: row.sessionPurpose ?? null,
      packageSessionsTotal: row.packageSessionsTotal ?? null,
      packageSessionsUsed: 0,
      subjectId: row.subjectId,
      levelId: row.levelId,
      boardId: row.boardId,
      topicIdsJson: toDbJson(
        row.subjectId === 'mathematics' && row.levelId === 'matric'
          ? ['math-matric-sindh-quadratic-equations']
          : [],
      )!,
      serviceTypeId: row.isTrial ? 'concept-clarification' : 'academic-tuition',
      mode: row.mode,
      areaId: row.areaId,
      // No address ciphertext is seeded. SEC-3 addresses are captured on a real
      // confirmation through `server/services/address.ts`, and a demonstration
      // dataset has no business carrying even a synthetic one.
      isTrial: toDbBool(row.isTrial ?? false),
      guardianPresenceRequired: toDbBool(row.guardianPresenceRequired ?? false),
      status: row.status,
      requestedAt: daysAgo(ctx.now, row.requestedDaysAgo),
      confirmedAt: ['confirmed', 'in_progress', 'completed', 'no_show'].includes(row.status)
        ? daysAgo(ctx.now, row.requestedDaysAgo - 1)
        : null,
      completedAt: row.status === 'completed' ? daysAgo(ctx.now, 3) : null,
      cancelledAt: terminal && row.status !== 'completed' ? daysAgo(ctx.now, 4) : null,
      createdAt: daysAgo(ctx.now, row.requestedDaysAgo),
    });

    bookingRegistry.set(row.key, {
      id,
      tutorId: row.tutor.profileId,
      parentUserId: row.requestedByUserId,
    });

    /* Session notes on completed monthly engagements — FR-12.1. The ratings
     * rise on one topic and stall on another, so the progress ledger's
     * stagnation indicator (FR-12.4) has something real to report. */
    if (row.status === 'completed' && row.engagementType === 'monthly') {
      const ratings = [
        { day: 40, quad: 2, geometry: 3 },
        { day: 30, quad: 3, geometry: 3 },
        { day: 20, quad: 4, geometry: 3 },
        { day: 10, quad: 5, geometry: 3 },
      ];
      for (const point of ratings) {
        await db.insert(sessionNotes).values({
          id: newId(),
          bookingId: id,
          tutorId: row.tutor.profileId,
          topicsCoveredJson: toDbJson(['math-matric-sindh-quadratic-equations'])!,
          masteryRatingsJson: toDbJson({
            'math-matric-sindh-quadratic-equations': point.quad,
            'math-matric-sindh-basic-geometry': point.geometry,
          })!,
          note:
            point.quad >= 4
              ? 'Solving the standard forms unaided now. Moved on to word problems.'
              : 'Still resolving sign errors when factorising. Repeated the prerequisite drill.',
          createdAt: daysAgo(ctx.now, point.day),
        });
      }
    }

    /* The trial's private fit check — visible to the family and to
     * administrators, never to the tutor and never on a public profile
     * (SEC-15, decision 11). */
    if (row.isTrial && row.status === 'completed') {
      await db.insert(trialFitChecks).values({
        id: newId(),
        bookingId: id,
        submittedBy: row.requestedByUserId,
        communication: 5,
        punctuality: 4,
        engagement: 5,
        pace: 3,
        continueDecision: toDbBool(true),
        note: 'Explained clearly and my son actually asked questions, which he never does. Pace was a little quick on the second half.',
        createdAt: daysAgo(ctx.now, 28),
      });
    }
  }

  return rows.length;
}

/* =========================================================================
 * Reviews — the credibility machinery has to be visible (FR-15.3)
 * ====================================================================== */

async function seedReviews(ctx: {
  db: Executor;
  now: Date;
  tutorIds: Map<string, { profileId: string; userId: string }>;
  parentIds: Map<string, string>;
}): Promise<number> {
  const { db, now } = ctx;
  let written = 0;

  for (const spec of DEMO_REVIEWS) {
    const booking = bookingRegistry.get(spec.bookingKey);
    if (!booking) continue;

    const reviewId = newId();
    await db.insert(reviews).values({
      id: reviewId,
      bookingId: booking.id,
      tutorId: booking.tutorId,
      reviewerUserId: booking.parentUserId,
      reviewerRole: 'parent',
      rating: spec.rating,
      text: spec.text,
      analysisStatus: 'analysed',
      createdAt: daysAgo(now, spec.daysAgo),
    });

    await db.insert(reviewAnalyses).values({
      id: newId(),
      reviewId,
      contentHash: `demo-${reviewId.slice(0, 12)}`,
      dimensionsJson: toDbJson(spec.dimensions)!,
      credibilityJson: toDbJson({
        completedSessionBasis: true,
        detailLevel: spec.detailLevel,
        generic: spec.generic,
        contradiction: spec.contradiction,
      })!,
      topicsMentionedJson: toDbJson(spec.topicsMentioned)!,
      safetyConcernFlag: toDbBool(spec.safetyConcern),
      safetyConcernReason: spec.safetyConcernReason ?? null,
      genericFlag: toDbBool(spec.generic),
      contradictionFlag: toDbBool(spec.contradiction),
      detailLevel: spec.detailLevel,
      completedSessions: spec.completedSessions,
      credibilityWeight: spec.credibilityWeight,
      model: 'demo-seed',
      promptVersion: 'review-intelligence.v1',
      createdAt: daysAgo(now, spec.daysAgo),
    });

    written += 1;
  }

  return written;
}

/* =========================================================================
 * Payments — every status, plus a dispute under resolution (§6.31)
 * ====================================================================== */

async function seedPayments(ctx: {
  db: Executor;
  now: Date;
  adminUserId: string;
}): Promise<number> {
  const { db, now, adminUserId } = ctx;

  const plan: {
    bookingKey: string;
    cycleLabel: string;
    amount: number;
    status: 'pending' | 'family_marked' | 'settled' | 'disputed';
    rateType: 'monthly' | 'single_session';
    engagementType: 'monthly' | 'single_session';
  }[] = [
    { bookingKey: DEMO_BOOKING_KEYS.completedMonthly, cycleLabel: '2026-05', amount: 1_800_000, status: 'settled', rateType: 'monthly', engagementType: 'monthly' },
    { bookingKey: DEMO_BOOKING_KEYS.completedMonthly, cycleLabel: '2026-06', amount: 1_800_000, status: 'family_marked', rateType: 'monthly', engagementType: 'monthly' },
    { bookingKey: DEMO_BOOKING_KEYS.completedMonthly2, cycleLabel: '2026-06', amount: 1_600_000, status: 'settled', rateType: 'monthly', engagementType: 'monthly' },
    { bookingKey: DEMO_BOOKING_KEYS.inProgress, cycleLabel: '2026-07', amount: 1_600_000, status: 'pending', rateType: 'monthly', engagementType: 'monthly' },
    { bookingKey: DEMO_BOOKING_KEYS.completedSingle, cycleLabel: '2026-07', amount: 300_000, status: 'disputed', rateType: 'single_session', engagementType: 'single_session' },
  ];

  let written = 0;
  let disputedRecordId: string | null = null;

  for (const row of plan) {
    const booking = bookingRegistry.get(row.bookingKey);
    if (!booking) continue;

    const id = newId();
    await db.insert(paymentRecords).values({
      id,
      bookingId: booking.id,
      cycleLabel: row.cycleLabel,
      agreedAmount: row.amount,
      travelCharge: 0,
      rateType: row.rateType,
      engagementType: row.engagementType,
      // A payment is settled only when BOTH parties have acknowledged it
      // (FR-31.4). A single-party claim stays `family_marked`.
      familyMarkedPaidAt: ['family_marked', 'settled', 'disputed'].includes(row.status)
        ? daysAgo(now, 12)
        : null,
      tutorConfirmedAt: row.status === 'settled' ? daysAgo(now, 11) : null,
      status: row.status,
      createdAt: daysAgo(now, 20),
    });

    if (row.status === 'disputed') disputedRecordId = id;
    written += 1;
  }

  /* One dispute, under review rather than resolved — so the administrator
   * queue is not empty and the resolution path is demonstrable (FR-31.7). */
  if (disputedRecordId) {
    const booking = bookingRegistry.get(DEMO_BOOKING_KEYS.completedSingle)!;
    await db.insert(paymentDisputes).values({
      id: newId(),
      paymentRecordId: disputedRecordId,
      raisedBy: booking.parentUserId,
      raisedByParty: 'family',
      reason: 'amount_disagreement',
      detail:
        'The session was agreed at PKR 2,500 for ninety minutes. The record shows PKR 3,000. I have the message where we agreed it.',
      status: 'under_review',
      resolvedBy: null,
      resolutionReason: null,
      resolvedAt: null,
      createdAt: daysAgo(now, 6),
    });

    await db.insert(adminActions).values({
      id: newId(),
      adminUserId,
      action: 'payment_dispute.opened_for_review',
      targetType: 'payment_dispute',
      targetId: disputedRecordId,
      detailJson: toDbJson({
        reason: 'Both parties contacted for their account of the agreed rate. Awaiting the tutor.',
      }),
      createdAt: daysAgo(now, 5),
    });
  }

  return written;
}

/* =========================================================================
 * One confirmed group — §6.23
 * ====================================================================== */

async function seedGroup(ctx: {
  db: Executor;
  now: Date;
  tutorIds: Map<string, { profileId: string; userId: string }>;
  studentIds: Map<string, string>;
}): Promise<void> {
  const { db, now, tutorIds, studentIds } = ctx;
  const tutor = tutorIds.get('ayesha-siddiqui')!;

  const proposalId = newId();
  const members: { studentKey: string; requestId: string }[] = [
    { studentKey: 'zara', requestId: newId() },
    { studentKey: 'ali', requestId: newId() },
  ];

  for (const member of members) {
    await db.insert(groupRequests).values({
      id: member.requestId,
      studentProfileId: studentIds.get(member.studentKey)!,
      subjectId: 'mathematics',
      levelId: 'matric',
      boardId: 'sindh-board',
      topicsJson: toDbJson(['math-matric-sindh-quadratic-equations'])!,
      areaId: member.studentKey === 'zara' ? 'karachi-clifton' : 'karachi-dha',
      areaFlex: toDbBool(true),
      // The group carries the STRICTEST requirement any member stated, and it
      // is enforced against the tutor in code — never relaxed (§2.12).
      genderPreference: 'female_only',
      maxGroupSize: 4,
      budgetMax: 900_000,
      availabilityJson: toDbJson([{ weekday: 1, start: '16:00', end: '18:00' }])!,
      status: 'proposed',
      createdAt: daysAgo(now, 40),
    });
  }

  await db.insert(groupProposals).values({
    id: proposalId,
    tutorId: tutor.profileId,
    subjectId: 'mathematics',
    levelId: 'matric',
    boardId: 'sindh-board',
    areaId: 'karachi-clifton',
    topicIdsJson: toDbJson(['math-matric-sindh-quadratic-equations'])!,
    availabilityJson: toDbJson([{ weekday: 1, start: '16:00', end: '18:00' }])!,
    genderPreference: 'female_only',
    groupKey: 'mathematics|matric|sindh-board|karachi-clifton|female_only',
    perHeadRate: 700_000,
    proposedAt: daysAgo(now, 35),
    status: 'confirmed',
    tutorAcceptedAt: daysAgo(now, 34),
    // `confirmed_at` is the commit point. Nothing is a group until this is set
    // (§2.12) — a cross-dialect transaction is impossible here.
    confirmedAt: daysAgo(now, 33),
    createdAt: daysAgo(now, 35),
  });

  for (const member of members) {
    await db.insert(groupMembers).values({
      proposalId,
      groupRequestId: member.requestId,
      studentProfileId: studentIds.get(member.studentKey)!,
      explanationJson: toDbJson({
        matchedOn: ['same subject, level and board', 'overlapping topic', 'adjacent areas with both families flexible', 'a shared Monday window'],
        // Never names another family (§2.12, SEC-14).
        genderNote: 'This group is female-only because at least one family requires it.',
      })!,
      bookingId: null,
      confirmedAt: daysAgo(now, 33),
      declinedAt: null,
    });
  }
}

/* =========================================================================
 * Platform feedback, volunteers, a flag in the queue
 * ====================================================================== */

async function seedPlatformData(ctx: {
  db: Executor;
  now: Date;
  parentIds: Map<string, string>;
  adminUserId: string;
  flaggedTutorId: string;
}): Promise<void> {
  const { db, now, parentIds, adminUserId } = ctx;

  await db.insert(platformFeedback).values([
    {
      id: newId(),
      userId: parentIds.get('parent-karachi')!,
      role: 'parent',
      category: 'usability',
      detail: 'The area filter is hard to find on a phone. I scrolled past it twice.',
      satisfactionRating: 3,
      pagePath: '/search',
      locale: 'en',
      appVersion: '0.1.0',
      safetyConcernFlag: 0,
      status: 'new',
      mailDispatchStatus: 'sent',
      createdAt: daysAgo(now, 4),
    },
    {
      id: newId(),
      // Anonymous: no user id and no other identity field (FR-32.6).
      userId: null,
      role: null,
      category: 'defect',
      detail: 'Urdu ka page right se left theek nahi ho raha kuch jagah par.',
      satisfactionRating: 2,
      pagePath: '/tutors',
      locale: 'ur',
      appVersion: '0.1.0',
      safetyConcernFlag: 0,
      status: 'triaged',
      dispositionNote: 'Reproduced on the profile header. Logged against the RTL work in §6.27.',
      triagedBy: adminUserId,
      triagedAt: daysAgo(now, 2),
      mailDispatchStatus: 'sent',
      createdAt: daysAgo(now, 9),
    },
    {
      id: newId(),
      userId: null,
      role: null,
      category: 'incorrect_ai_output',
      detail: 'The guided intake suggested a topic my daughter finished last year.',
      satisfactionRating: 2,
      pagePath: '/intake',
      locale: 'en',
      appVersion: '0.1.0',
      safetyConcernFlag: 0,
      status: 'actioned',
      dispositionNote: 'Prompt updated to weight the stated level more heavily. Tracked to review-intelligence.v1.',
      triagedBy: adminUserId,
      triagedAt: daysAgo(now, 1),
      mailDispatchStatus: 'sent',
      createdAt: daysAgo(now, 14),
    },
  ]);

  /* One report sitting in the moderation queue (FR-14.1, FR-14.2), and one
   * already resolved with a written reason, so the queue demonstrates both
   * halves. The reporter is recorded but is never shown to the target. */
  await db.insert(flags).values([
    {
      id: newId(),
      targetType: 'tutor_profile',
      targetId: ctx.flaggedTutorId,
      reporterUserId: parentIds.get('parent-karachi-2')!,
      reason: 'inaccurate_profile',
      detail: 'The profile says eleven years of experience but she told us she started last year.',
      status: 'open',
      createdAt: daysAgo(now, 2),
    },
    {
      id: newId(),
      targetType: 'review',
      targetId: 'demo-resolved-review',
      reporterUserId: parentIds.get('parent-karachi')!,
      reason: 'abusive_content',
      detail: 'The review names my child.',
      status: 'actioned',
      resolvedBy: adminUserId,
      resolutionNote:
        'Confirmed. The review named a minor and has been removed. The reviewer has been asked to resubmit without the name.',
      resolvedAt: daysAgo(now, 6),
      createdAt: daysAgo(now, 7),
    },
  ]);

  await db.insert(volunteerApplications).values([
    {
      id: newId(),
      fullName: 'Sidra Kamal',
      email: 'sidra.kamal@demo.ustaad.test',
      phone: '03001234567',
      cityId: 'karachi',
      areaId: 'karachi-nazimabad',
      gender: 'female',
      subjectsJson: toDbJson(['mathematics', 'physics'])!,
      levelsJson: toDbJson(['matric'])!,
      weeklyHours: 6,
      deliveryModesJson: toDbJson(['home', 'online'])!,
      motivation: 'I was taught free of charge when my family could not pay, and I would like to do the same.',
      documentPath: null,
      status: 'received',
      mailDispatchStatus: 'sent',
      createdAt: daysAgo(now, 3),
    },
    {
      id: newId(),
      fullName: 'Junaid Aslam',
      email: 'junaid.aslam@demo.ustaad.test',
      phone: '03211234567',
      cityId: 'lahore',
      areaId: 'lahore-township',
      gender: 'male',
      subjectsJson: toDbJson(['chemistry'])!,
      levelsJson: toDbJson(['intermediate'])!,
      weeklyHours: 4,
      deliveryModesJson: toDbJson(['online'])!,
      motivation: 'I teach at a school and have four free hours a week.',
      documentPath: null,
      status: 'contacted',
      reviewedBy: adminUserId,
      reviewNote: 'Contacted for a verification appointment.',
      mailDispatchStatus: 'sent',
      createdAt: daysAgo(now, 18),
    },
    {
      id: newId(),
      fullName: 'Mehwish Raza',
      email: 'mehwish.raza@demo.ustaad.test',
      phone: '03331234567',
      cityId: 'islamabad',
      areaId: 'islamabad-g-9',
      gender: 'female',
      subjectsJson: toDbJson(['english'])!,
      levelsJson: toDbJson(['primary', 'middle'])!,
      weeklyHours: 3,
      deliveryModesJson: toDbJson(['home'])!,
      motivation: 'Retired teacher. I have time and I miss the work.',
      documentPath: null,
      status: 'verified',
      reviewedBy: adminUserId,
      reviewNote: 'CNIC and teaching certificate checked. Converted to a draft tutor account, which must still clear §6.6 before it is searchable.',
      // A `skipped` dispatch is honestly recorded rather than claimed as sent
      // (§2.13) — EmailJS was not configured when this application arrived.
      mailDispatchStatus: 'skipped',
      createdAt: daysAgo(now, 50),
    },
  ]);
}

/* =========================================================================
 * One open vacancy with an expression of interest — §6.13
 * ====================================================================== */

async function seedVacancy(ctx: {
  db: Executor;
  now: Date;
  orgProfileId: string;
  tutorIds: Map<string, { profileId: string; userId: string }>;
}): Promise<void> {
  const { db, now, orgProfileId, tutorIds } = ctx;

  const vacancyId = newId();
  await db.insert(vacancies).values({
    id: vacancyId,
    orgId: orgProfileId,
    subjectId: 'mathematics',
    levelId: 'matric',
    boardId: 'sindh-board',
    mode: 'home',
    rateOffered: 2_000_000,
    rateType: 'monthly',
    areaId: 'karachi-gulshan-e-iqbal',
    description:
      'We need a female tutor for three of our Matric students who cannot travel to the centre. Three evenings a week in Gulshan-e-Iqbal.',
    status: 'open',
    createdAt: daysAgo(now, 12),
  });

  // One action, no cover letter (FR-13.4). `expressed` is the only status any
  // code path writes — FR-13.5's pipeline is the ATS decision 4 removed.
  await db.insert(vacancyInterests).values({
    id: newId(),
    vacancyId,
    tutorId: tutorIds.get('fatima-noor')!.profileId,
    status: 'expressed',
    createdAt: daysAgo(now, 9),
  });
}

/* =========================================================================
 * Unmet demand — cohorts of three, so suppression does not empty the board
 * ====================================================================== */

async function seedUnmetDemand(db: Executor, now: Date): Promise<void> {
  /* SEC-16 suppresses cohorts below three, so a demonstration board needs at
   * least three identical rows per cohort to show anything at all. That is the
   * control working, not a workaround: two families wanting the same thing is
   * not a market signal, it is two families. */
  const cohorts = [
    { subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board', areaId: 'karachi-korangi', gender: 'female_only' as const, count: 4 },
    { subjectId: 'chemistry', levelId: 'intermediate', boardId: 'sindh-board', areaId: 'karachi-malir', gender: 'female_only' as const, count: 3 },
    { subjectId: 'english', levelId: 'o-level', boardId: 'cambridge', areaId: 'lahore-johar-town', gender: 'no_preference' as const, count: 3 },
    // Deliberately below the threshold: the board must NOT show this one.
    { subjectId: 'physics', levelId: 'a-level', boardId: 'cambridge', areaId: 'islamabad-f-7', gender: 'no_preference' as const, count: 2 },
  ];

  for (const cohort of cohorts) {
    for (let i = 0; i < cohort.count; i += 1) {
      await db.insert(unmetDemand).values({
        id: newId(),
        subjectId: cohort.subjectId,
        topicIdsJson: toDbJson([])!,
        levelId: cohort.levelId,
        boardId: cohort.boardId,
        areaId: cohort.areaId,
        genderPreference: cohort.gender,
        // Banded on write — no exact budget is ever stored (§2.8, SEC-16).
        budgetMax: 800_000,
        reason: 'no_matches',
        createdAt: daysAgo(now, 5 + i),
      });
    }
  }
}

/* =========================================================================
 * CLI
 * ====================================================================== */

async function main(): Promise<void> {
  /*
   * Asks the driver what it actually resolved, **not** whether one particular
   * variable is set. `server/db/index.ts` now accepts a Postgres URL from more
   * than one name, and a guard written against a single name would have
   * stopped firing the moment a second was added — silently, and in the one
   * place where failing silently means seeding invented people with a
   * published password into a live database (FR-15.9).
   */
  const { DB_DIALECT } = await import('../../index');

  if (DB_DIALECT === 'postgres') {
    console.error(
      '✗ Refusing to run. A Postgres connection string is set, so the configured\n' +
        '  database is production. This seed writes invented people with a password\n' +
        '  published in the README.\n' +
        '  Unset SUPABASE_DB_URL / NETLIFY_DATABASE_URL to seed the local SQLite file.',
    );
    process.exitCode = 1;
    return;
  }

  const { db } = await import('../../index');
  console.log('▸ seeding demonstration data (§6.15)');

  const result = await seedDemoData(db as unknown as Executor);

  console.log(`  tutors                 ${result.tutors}`);
  console.log(`  parents                ${result.parents}`);
  console.log(`  student profiles       ${result.students}`);
  console.log(`  bookings               ${result.bookings}`);
  console.log(`  reviews                ${result.reviews}`);
  console.log(`  payment records        ${result.payments}`);
  console.log(`  agent sessions (demo)  ${result.agentSessions}`);
  console.log('▸ materialisation jobs');
  console.log(`  tutor_scores           ${result.jobs.scores}`);
  console.log(`  tutor_reliability      ${result.jobs.reliability}`);
  console.log(`  rate_benchmarks        ${result.jobs.benchmarks}`);
  console.log('✓ demonstration data seeded. Guest credentials are in the README.');
}

// Run only when invoked directly, not when imported by a test.
if (process.argv[1]?.includes('demo')) {
  main().catch((error) => {
    console.error('✗ demo seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
