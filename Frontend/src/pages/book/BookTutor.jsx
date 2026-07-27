/**
 * Requesting a booking — §6.8, §6.20, §6.30.
 *
 * ── One page, three shapes, validated by the server's own schema ───────────
 * `createBookingSchema` in `/shared` is a **discriminated union**, so "a single
 * session with no stated purpose" is not representable — the schema will not
 * build the object. This page imports that union and validates against it
 * before posting, which means the required-ness of the single-session fields
 * is not a decision the client makes and could get wrong.
 *
 * ── The single session is where the care goes (FR-30.4) ────────────────────
 * Purpose and topics are **required**, and the copy says why rather than
 * marking them with an asterisk: the difference between a useful hour and a
 * wasted one is whether the tutor arrives knowing what the hour is for. A
 * tutor who spends the first twenty minutes working out why the student came
 * has spent a third of the engagement on discovery.
 *
 * ── What this page never does ─────────────────────────────────────────────
 * It does not take a payment, quote a total to be paid now, or collect a card
 * — there is no such endpoint and there never will be (§2.6). It records what
 * two people agreed. The rate shown is the rate frozen onto the record at
 * confirmation, not a charge.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';

import { createBookingSchema, SESSION_PURPOSES } from '@shared/booking';
// The engine's own rule, not a copy of it — see `violations` below.
import { checkEngagementAgainstConstraints } from '@shared/tutor-onboarding';

import { AddressDisclosure, GuardianPresenceNotice } from '../../components/booking/SafetyAndDisclosure';
import { PaymentBoundaryNotice } from '../../components/payments/PaymentBoundaryNotice';
import { SlotCalendar } from '../../components/booking/SlotCalendar';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Field';
import { FormErrorSummary } from '../../components/form/FormErrorSummary';
import { useToast } from '../../context/ToastContext';
import { api, ApiError } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { keys } from '../../lib/queryClient';

/** `2026-07-27` for today, and the same date fourteen days on. */
function dateWindow(days = 14) {
  const today = new Date();
  const iso = (date) => date.toISOString().slice(0, 10);
  const end = new Date(today);
  end.setDate(end.getDate() + days);
  return { fromDate: iso(today), toDate: iso(end) };
}

const ENGAGEMENT_TYPES = ['single_session', 'short_term_package', 'monthly'];

export default function BookTutor() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { t } = useTranslation(['booking', 'common', 'search']);
  const navigate = useNavigate();
  const toast = useToast();
  const fmt = useFormat();

  /**
   * What the home-tuition pathway established, if the family came that way.
   *
   * Carried in navigation state rather than the query string: it is context for
   * this form, not an address anybody should be able to construct or share, and
   * a family who reloads mid-form falls back to answering here — which is the
   * ordinary path, not a broken one.
   */
  const pathway = useLocation().state ?? null;

  const requested = params.get('engagementType');
  const [engagementType, setEngagementType] = useState(
    ENGAGEMENT_TYPES.includes(requested) ? requested : 'single_session',
  );

  const [slot, setSlot] = useState(null);
  const [mode, setMode] = useState(null);
  const [studentProfileId, setStudentProfileId] = useState('');
  const [claimId, setClaimId] = useState('');
  const [topicIds, setTopicIds] = useState([]);
  const [sessionPurpose, setSessionPurpose] = useState(SESSION_PURPOSES[0]);
  const [sessionsPerWeek, setSessionsPerWeek] = useState(2);
  const [cycleWeeks, setCycleWeeks] = useState(4);
  const [packageSessionsTotal, setPackageSessionsTotal] = useState(6);
  const [address, setAddress] = useState('');
  const [guardianAcknowledged, setGuardianAcknowledged] = useState(false);
  const [isTrial, setIsTrial] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);

  /* --- The tutor ------------------------------------------------------- */

  const profile = useQuery({
    queryKey: keys.tutor(slug),
    queryFn: () => api.get(`/tutors/public/${slug}`),
    enabled: Boolean(slug),
  });

  const tutor = profile.data?.tutor ?? null;
  const claims = profile.data?.claims ?? [];
  const rates = profile.data?.rates ?? [];
  const safety = profile.data?.safety ?? null;

  /* --- The family's students -------------------------------------------- */

  const students = useQuery({
    queryKey: ['students', 'mine'],
    queryFn: async () => (await api.get('/students'))?.items ?? [],
  });

  /* --- Free slots, refetched on every mode change ------------------------ */

  const window = useMemo(() => dateWindow(14), []);

  const slots = useQuery({
    queryKey: ['slots', tutor?.id, window.fromDate, window.toDate, mode],
    queryFn: async () => {
      const params = new URLSearchParams({
        tutorId: tutor.id,
        fromDate: window.fromDate,
        toDate: window.toDate,
        ...(mode ? { mode } : {}),
      });
      return (await api.get(`/bookings/slots?${params}`))?.slots ?? [];
    },
    enabled: Boolean(tutor?.id),
  });

  // A slot chosen under one mode may not exist under another. Clearing it is
  // the honest response — silently keeping it would submit a slot the family
  // can no longer see on the grid.
  useEffect(() => {
    setSlot(null);
  }, [mode]);


  const claim = claims.find((c) => c.id === claimId) ?? claims[0] ?? null;
  const student = (students.data ?? []).find((s) => s.id === studentProfileId) ?? null;

  /**
   * Guardian presence starts on for a minor — FR-29.7.
   *
   * The default is the protective answer and the parent has to actively change
   * it, rather than the form starting at "not required" and relying on somebody
   * noticing a checkbox. It is set when the student is chosen, not pinned: a
   * default that could not be changed would be the platform overriding a
   * parent's judgement about their own child, which is a different thing from
   * choosing the safer starting point on their behalf.
   */
  useEffect(() => {
    if (student?.parentOwned) setGuardianAcknowledged(true);
  }, [student?.id, student?.parentOwned]);

  /* --- Her conditions, applied here rather than reported later — FR-29.11 -- */

  /**
   * The violations this request currently carries, if any.
   *
   * `checkEngagementAgainstConstraints` is the **same function the booking
   * engine runs** (`shared/tutor-onboarding.js`), not a copy of its rules. That
   * is the whole point: a UI that reimplemented these would eventually block
   * something the server allows, or worse, let through a request she would have
   * to decline — and SEC-21 exists precisely so she is never put in that
   * position.
   *
   * Evaluated only once a student is chosen. Before that there is no engagement
   * to check, and showing "this tutor teaches female students only" as an error
   * against an empty form reads as a rejection of the family.
   */
  const violations = useMemo(() => {
    if (!safety || !student) return [];
    return checkEngagementAgainstConstraints(
      {
        femaleStudentsOnly: safety.femaleStudentsOnly ?? false,
        guardianPresenceRequired: safety.guardianPresenceRequired ?? false,
        restrictedAreaIds: safety.restrictedAreaIds ?? [],
      },
      {
        studentGender: student.gender ?? null,
        areaId: slot?.areaId ?? null,
        guardianPresenceOffered: guardianAcknowledged,
        mode: mode ?? slot?.mode ?? 'home',
      },
    );
  }, [safety, student, slot, guardianAcknowledged, mode]);

  /*
   * A violation that the family cannot resolve on this form is a different
   * thing from one they can. Her gender restriction and her area restriction
   * are facts about this pairing — no answer on this page changes them — so the
   * request is blocked outright. The guardian condition is a question they have
   * not answered yet, so it disables the button without being phrased as a
   * refusal.
   */
  const blocking = violations.filter((v) => v.constraint !== 'guardian_presence_required');
  const canRequest = violations.length === 0;

  /* --- Submit ------------------------------------------------------------ */

  const create = useMutation({
    mutationFn: (body) => api.post('/bookings', body),
    onSuccess: ({ booking }) => {
      // The action name matches the button: "Send request" → "Request sent".
      toast.show({ tone: 'success', title: t('request.sent') });
      navigate(`/my/bookings/${booking.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'slot_taken') {
        // Somebody else took it between load and submit. Say so, and refetch,
        // rather than leaving a grid that disagrees with the server.
        setFormError(t('request.slotTaken'));
        setSlot(null);
        slots.refetch();
        return;
      }
      // `tutor_constraints_not_met` — the code the service actually raises.
      // The acknowledgement checkbox exists so this is rare, but a family who
      // reaches it must be told which condition stopped them, not just "409".
      if (error instanceof ApiError && error.code === 'tutor_constraints_not_met') {
        setErrors({ guardianPresenceAcknowledged: t('safety.refused') });
        return;
      }
      setFormError(error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    setErrors({});
    setFormError(null);

    /*
     * The disabled button is the courtesy; this is the rule. A disabled control
     * is a hint to a person, not a guarantee — it can be cleared from a console
     * in a second — and the request must be impossible from this form rather
     * than merely discouraged (FR-29.11). The server checks it a third time.
     */
    if (violations.length > 0) {
      setFormError(t(`safety.violation.${violations[0].constraint}`));
      return;
    }

    const common = {
      tutorId: tutor.id,
      studentProfileId,
      subjectId: claim?.subjectId ?? '',
      levelId: claim?.levelId ?? '',
      boardId: claim?.boardId ?? '',
      mode: mode ?? slot?.mode ?? 'home',
      areaId: slot?.areaId ?? null,
      slotStart: slot?.startsAt ?? '',
      slotEnd: slot?.endsAt ?? '',
      guardianPresenceAcknowledged: guardianAcknowledged,
      isTrial,
      // Set when the family arrived through the home-tuition pathway, which
      // asked which kind of engagement this is (FR-29.4). Absent otherwise —
      // an academic booking made from a profile answers no such question.
      ...(pathway?.serviceTypeId ? { serviceTypeId: pathway.serviceTypeId } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
    };

    const shaped =
      engagementType === 'single_session'
        ? { ...common, engagementType, sessionPurpose, topicIds }
        : engagementType === 'short_term_package'
          ? { ...common, engagementType, packageSessionsTotal, topicIds }
          : { ...common, engagementType, sessionsPerWeek, cycleWeeks, topicIds };

    // The server's own schema, not a copy of its rules (NFR-6, NFR-7).
    const parsed = createBookingSchema.safeParse(shaped);
    if (!parsed.success) {
      const collected = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_form';
        if (!(key in collected)) collected[key] = issue.message;
      }
      setErrors(collected);
      return;
    }

    create.mutate(parsed.data);
  }

  if (profile.isPending) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <SkeletonCard label={t('common:state.loading')} />
      </div>
    );
  }

  if (profile.isError) {
    return (
      <div className="mx-auto max-w-prose px-4 py-8">
        <ErrorState error={profile.error} onRetry={profile.refetch} />
      </div>
    );
  }

  if (!tutor) return null;

  const applicableRate = rates.find((rate) =>
    engagementType === 'single_session'
      ? rate.rateType === 'single_session'
      : engagementType === 'monthly'
        ? rate.rateType === 'monthly'
        : rate.rateType === 'hourly' || rate.rateType === 'single_session',
  );

  return (
    <div className="mx-auto max-w-prose px-4 py-6">
      <p className="text-small text-slate">
        <Link to={`/t/${slug}`} className="underline underline-offset-2">
          {tutor.displayName}
        </Link>
      </p>
      <h1 className="mt-1 font-display text-display text-ink">{t('request.title')}</h1>

      <form onSubmit={submit} noValidate className="mt-6 space-y-6">
        <FormErrorSummary errors={errors} formError={formError} />

        {/* --- Shape ------------------------------------------------------ */}
        <fieldset>
          <legend className="text-caption font-semibold uppercase tracking-wide text-slate">
            {t('request.engagementLegend')}
          </legend>

          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {ENGAGEMENT_TYPES.map((type) => (
              <label
                key={type}
                className={[
                  'flex min-h-tap cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-small',
                  engagementType === type
                    ? 'border-verdigris-deep bg-verdigris-soft text-ink'
                    : 'border-slate-line bg-white text-ink',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="engagementType"
                  value={type}
                  checked={engagementType === type}
                  onChange={() => setEngagementType(type)}
                  className="h-4 w-4 text-verdigris-deep focus:ring-verdigris-deep"
                />
                {t(`search:booking.${type === 'short_term_package' ? 'package' : type === 'single_session' ? 'single' : 'monthly'}.title`)}
              </label>
            ))}
          </div>
        </fieldset>

        {/* --- Who it is for ---------------------------------------------- */}
        <Field
          label={t('request.studentLabel')}
          hint={t('request.studentHint')}
          error={errors.studentProfileId}
          required
          htmlFor="student"
        >
          {(props) => (
            <Select {...props}
              id="student"
              value={studentProfileId}
              onChange={(event) => setStudentProfileId(event.target.value)}
            >
              <option value="">{t('request.studentPlaceholder')}</option>
              {(students.data ?? []).map((student) => (
                <option key={student.id} value={student.id}>
                  {student.displayName ?? student.fullName}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/* --- What --------------------------------------------------------- */}
        <Field
          label={t('request.claimLabel')}
          error={errors.subjectId ?? errors.levelId ?? errors.boardId}
          required
          htmlFor="claim"
        >
          {(props) => (
            <Select {...props} id="claim" value={claimId} onChange={(event) => setClaimId(event.target.value)}>
              {claims.map((option) => (
                <option key={option.id} value={option.id}>
                  {[option.subjectName, option.levelName, option.boardName].filter(Boolean).join(' · ')}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/* --- Single session: purpose and topics are required ------------- */}
        {engagementType === 'single_session' ? (
          <Card>
            <CardBody className="space-y-4">
              <div>
                <h2 className="font-display text-subtitle text-ink">{t('single.heading')}</h2>
                {/*
                  Why these are required, rather than an asterisk. FR-30.4.
                */}
                <p className="mt-0.5 text-caption text-slate">{t('single.whyRequired')}</p>
              </div>

              <Field
                label={t('single.purposeLabel')}
                error={errors.sessionPurpose}
                required
                htmlFor="purpose"
              >
                {(props) => (
                  <Select {...props}
                    id="purpose"
                    value={sessionPurpose}
                    onChange={(event) => setSessionPurpose(event.target.value)}
                  >
                    {SESSION_PURPOSES.map((purpose) => (
                      <option key={purpose} value={purpose}>
                        {t(`single.purpose.${purpose}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field
                label={t('single.topicsLabel')}
                hint={t('single.topicsHint')}
                error={errors.topicIds}
                required
              >
                <ul className="space-y-1">
                  {(claim?.topicNames ?? []).length === 0 ? (
                    <li className="text-caption text-slate">{t('single.noTopics')}</li>
                  ) : null}
                  {(claim?.topicIds ?? claim?.topicNames ?? []).map((topic, index) => {
                    const id = claim?.topicIds?.[index] ?? topic;
                    const name = claim?.topicNames?.[index] ?? topic;
                    return (
                      <li key={id}>
                        <Checkbox
                          checked={topicIds.includes(id)}
                          onChange={(event) =>
                            setTopicIds((current) =>
                              event.target.checked
                                ? [...current, id]
                                : current.filter((value) => value !== id),
                            )
                          }
                          label={name}
                        />
                      </li>
                    );
                  })}
                </ul>
              </Field>
            </CardBody>
          </Card>
        ) : null}

        {/* --- Monthly cycle ----------------------------------------------- */}
        {engagementType === 'monthly' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('monthly.sessionsPerWeekLabel')}
              error={errors.sessionsPerWeek}
              required
              htmlFor="spw"
            >
              {(props) => (
                <Input {...props}
                  id="spw"
                  type="number"
                  min={1}
                  max={7}
                  value={sessionsPerWeek}
                  onChange={(event) => setSessionsPerWeek(Number(event.target.value))}
                />
              )}
            </Field>
            <Field
              label={t('monthly.cycleWeeksLabel')}
              hint={t('monthly.cycleWeeksHint')}
              error={errors.cycleWeeks}
              required
              htmlFor="weeks"
            >
              {(props) => (
                <Input {...props}
                  id="weeks"
                  type="number"
                  min={1}
                  max={12}
                  value={cycleWeeks}
                  onChange={(event) => setCycleWeeks(Number(event.target.value))}
                />
              )}
            </Field>
          </div>
        ) : null}

        {/* --- Package ------------------------------------------------------ */}
        {engagementType === 'short_term_package' ? (
          <Field
            label={t('package.sessionsLabel')}
            hint={t('package.sessionsHint')}
            error={errors.packageSessionsTotal}
            required
            htmlFor="package-total"
          >
            {(props) => (
              <Input {...props}
                id="package-total"
                type="number"
                min={2}
                max={40}
                value={packageSessionsTotal}
                onChange={(event) => setPackageSessionsTotal(Number(event.target.value))}
              />
            )}
          </Field>
        ) : null}

        {/* --- Mode and slot ------------------------------------------------ */}
        <Field label={t('request.modeLabel')} htmlFor="mode">
          {(props) => (
            <Select {...props} id="mode" value={mode ?? ''} onChange={(event) => setMode(event.target.value || null)}>
              <option value="">{t('request.modeAny')}</option>
              {tutor.teachesAtHome ? <option value="home">{t('common:mode.home')}</option> : null}
              {tutor.teachesOnline ? <option value="online">{t('common:mode.online')}</option> : null}
              {tutor.teachesAtOwnPlace ? (
                <option value="own_place">{t('common:mode.own_place')}</option>
              ) : null}
            </Select>
          )}
        </Field>

        <fieldset>
          <legend className="text-caption font-semibold uppercase tracking-wide text-slate">
            {t('slots.legend')}
          </legend>
          <div className="mt-2">
            {slots.isPending ? (
              <SkeletonCard label={t('common:state.loading')} />
            ) : (
              <SlotCalendar slots={slots.data ?? []} value={slot} onChange={setSlot} />
            )}
            {errors.slotStart ? (
              <p className="mt-2 text-small text-flag">{errors.slotStart}</p>
            ) : null}
          </div>
        </fieldset>

        {/* --- Address, and what the tutor will see (SEC-20) --------------- */}
        {(mode ?? slot?.mode) === 'home' ? (
          <div className="space-y-3">
            <Field
              label={t('request.addressLabel')}
              hint={t('request.addressHint')}
              error={errors.address}
              htmlFor="address"
            >
              {(props) => (
                <Textarea {...props}
                  id="address"
                  rows={2}
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
              )}
            </Field>
            <AddressDisclosure audience="family" />
          </div>
        ) : null}

        {/* --- Her conditions ---------------------------------------------- */}
        <GuardianPresenceNotice
          safety={safety}
          acknowledged={guardianAcknowledged}
          onAcknowledge={setGuardianAcknowledged}
          error={errors.guardianPresenceAcknowledged}
        />

        {/* --- Trial (§6.20) ------------------------------------------------ */}
        <Card>
          <CardBody>
            <Checkbox
              checked={isTrial}
              onChange={(event) => setIsTrial(event.target.checked)}
              label={t('trial.flagLabel')}
              hint={t('trial.flagHint')}
            />
          </CardBody>
        </Card>

        {/* --- What is being agreed, not charged --------------------------- */}
        {applicableRate ? (
          <Card>
            <CardBody className="space-y-1">
              <h2 className="font-display text-subtitle text-ink">{t('request.agreedHeading')}</h2>
              <p className="font-mono text-body tnum text-ink">{fmt.paisa(applicableRate.amount)}</p>
              {applicableRate.travelCharge > 0 ? (
                <p className="font-mono text-small tnum text-slate">
                  {t('request.travelCharge', { amount: fmt.paisa(applicableRate.travelCharge) })}
                </p>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        <PaymentBoundaryNotice />

        {/*
          A condition this form cannot satisfy — FR-29.11.

          Shown as a statement of her terms, in her voice, not as an error the
          family committed. They have not done anything wrong; this pairing does
          not meet a condition she set, and the honest thing is to say which one
          and stop, rather than to accept a request that would reach her as one
          she has to decline.
        */}
        {blocking.length > 0 ? (
          <section
            role="status"
            aria-labelledby="cannot-request-heading"
            className="rounded-control border border-seal/35 bg-seal-soft px-4 py-3"
          >
            <h2
              id="cannot-request-heading"
              className="text-caption font-semibold uppercase tracking-wide text-seal-deep"
            >
              {t('safety.cannotRequestHeading')}
            </h2>
            <ul className="mt-2 space-y-1 text-small text-ink">
              {blocking.map((violation) => (
                <li key={violation.constraint}>{t(`safety.violation.${violation.constraint}`)}</li>
              ))}
            </ul>
            <p className="mt-2 text-caption text-slate">{t('safety.cannotRequestBody')}</p>
          </section>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="accent"
            loading={create.isPending}
            disabled={!canRequest}
          >
            {t('request.submit')}
          </Button>
          <Button as={Link} to={`/t/${slug}`} variant="ghost">
            {t('common:action.cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}
