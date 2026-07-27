# -*- coding: utf-8 -*-
import io, os

base = os.path.join(os.path.dirname(__file__), '..')
p = os.path.join(base, 'src/pages/public/TutorProfile.jsx')
s = io.open(p, encoding='utf-8').read()

# --- the endpoint -------------------------------------------------------
s = s.replace(
    "    queryFn: () => api.get(`/tutors/${slug}`),",
    "    queryFn: () => api.get(`/tutors/public/${slug}`),")

# --- destructure what the server actually returns ------------------------
s = s.replace(
    "  const { tutor, identity, competency = [], rates = [], availability = [] } = profile.data ?? {};\n  if (!tutor) return null;\n\n  const area = tutor.area ?? null;\n  const areaName = area ? localName(area) : null;\n  const inTray = tray.has(tutor.id);",
    """  const {
    tutor,
    verification,
    claims = [],
    rates = [],
    availability = [],
    reliability = null,
    normalisedHourly = null,
    benchmarkMedian = null,
  } = profile.data ?? {};
  if (!tutor) return null;

  /*
   * Area, never a street (SEC-3). A tutor states the areas she will travel
   * to; the profile names them and stops there. There is no map on this page
   * and no coordinate behind it — §4.2 puts GPS permanently out of scope.
   */
  const cityName = localName({ id: tutor.cityId, name: tutor.cityId });
  const inTray = tray.has(tutor.id);

  // Verified topics carry a date and an expiry; asserted ones carry neither
  // and must never be rendered as a verification (§2.5).
  const verifiedClaims = claims.filter((claim) => claim.claimStatus === 'verified');
  const assertedClaims = claims.filter((claim) => claim.claimStatus !== 'verified');

  const deliveryModes = [
    tutor.teachesAtHome ? 'home' : null,
    tutor.teachesOnline ? 'online' : null,
    tutor.teachesAtOwnPlace ? 'own_place' : null,
  ].filter(Boolean);""")

# --- header block --------------------------------------------------------
s = s.replace(
    """              {tutor.displayName?.[0] ?? '?'}""",
    """              {tutor.displayName?.[0] ?? '?'}""")

s = s.replace(
    """              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-slate">
                {areaName ? <span lang={areaName.lang}>{areaName.text}</span> : null}
                {tutor.experienceYears ? (
                  <span className="tnum">
                    {t('card.experience', { count: tutor.experienceYears })}
                  </span>
                ) : null}
              </p>""",
    """              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-slate">
                {cityName ? <span lang={cityName.lang}>{cityName.text}</span> : null}
                {tutor.experienceYears ? (
                  <span className="tnum">
                    {t('card.experience', { count: tutor.experienceYears })}
                  </span>
                ) : null}
              </p>""")

s = s.replace(
    """                {tutor.volunteerFlag ? <Badge tone="settled">{t('card.volunteer')}</Badge> : null}
                {(tutor.deliveryModes ?? []).map((mode) => (""",
    """                {tutor.volunteer ? <Badge tone="settled">{t('card.volunteer')}</Badge> : null}
                {deliveryModes.map((mode) => (""")

s = s.replace(
    """                tray.toggle({
                  tutorId: tutor.id,
                  slug: tutor.slug,
                  displayName: tutor.displayName,
                  areaId: tutor.areaId ?? null,
                })""",
    """                tray.toggle({
                  tutorId: tutor.id,
                  slug: tutor.slug,
                  displayName: tutor.displayName,
                  areaId: tutor.willingAreaIds?.[0] ?? null,
                })""")

# --- verification section -------------------------------------------------
s = s.replace(
    """            {identity ? (
              <IdentityRecord
                artefacts={(identity.artefactsChecked ?? []).map((artefact) => ({
                  artefact,
                  checkedOn: identity.decidedAt,
                }))}
                decidedBy={identity.decidedBy}
                decidedAt={identity.decidedAt}
              />
            ) : null}

            {competency.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {competency.map((verdict) => (
                  <CompetencyRecord
                    key={verdict.topicId}
                    topic={verdict.topicName ?? verdict.topicId}
                    outcome={verdict.status === 'verified' ? 'passed' : 'failed'}
                    assessedAt={verdict.verifiedAt}
                    expiresOn={verdict.expiresOn}
                  />
                ))}
              </div>
            ) : (
              <p className="text-small text-slate">{t('reviews.noCompetencyYet')}</p>
            )}""",
    """            {/* Identity: administrator-checked, itemised by artefact (FR-6.5). */}
            {verification?.verifiedOn ? (
              <IdentityRecord
                artefacts={(verification.artefactsChecked ?? []).map((artefact) => ({
                  artefact,
                  checkedOn: verification.verifiedOn,
                }))}
                decidedBy={verification.verifiedBy}
                decidedAt={verification.verifiedOn}
              />
            ) : null}

            {/*
              Competency: a separate track, per topic, AI-assessed. The two are
              never merged into one badge (FR-6.2) — which is why they are two
              components with two headings rather than a combined list.
            */}
            {verifiedClaims.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {verifiedClaims.map((claim) => (
                  <CompetencyRecord
                    key={claim.id}
                    topic={[claim.subjectName, claim.levelName].filter(Boolean).join(' — ')}
                    outcome="passed"
                    assessedAt={claim.verifiedAt}
                    expiresOn={claim.expiresOn}
                  />
                ))}
              </div>
            ) : (
              <p className="text-small text-slate">{t('reviews.noCompetencyYet')}</p>
            )}

            {/*
              What she says she teaches, kept visually distinct from what was
              tested. Dashed, no seal, and the words "not yet tested" — an
              asserted claim rendered like a verified one is the single most
              damaging thing this page could do (§2.5).
            */}
            {assertedClaims.length > 0 ? (
              <div>
                <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">
                  {t('tutor:claims.assertedHeading')}
                </h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {assertedClaims.map((claim) => (
                    <li
                      key={claim.id}
                      className="rounded-control border border-dashed border-slate-line px-2.5 py-1 text-caption text-slate"
                    >
                      {[claim.subjectName, claim.levelName, claim.boardName]
                        .filter(Boolean)
                        .join(' · ')}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-caption text-slate">
                  {t('tutor:claims.assertedNote')}
                </p>
              </div>
            ) : null}""")

# --- rates / benchmark ----------------------------------------------------
s = s.replace(
    """            <RateBenchmarkPanel
              normalisedHourly={profile.data.normalisedHourly}
              median={profile.data.benchmarkMedian}
              areaName={areaName?.text}
              subjectName={profile.data.primarySubjectName}
            />""",
    """            <RateBenchmarkPanel
              normalisedHourly={normalisedHourly}
              median={benchmarkMedian}
              areaName={cityName?.text}
              subjectName={claims[0]?.subjectName}
            />""")

# --- reliability ----------------------------------------------------------
s = s.replace("<ReliabilityChart reliability={tutor.reliability} />",
              "<ReliabilityChart reliability={reliability} />")

# --- booking --------------------------------------------------------------
s = s.replace("<BookingOptions tutor={tutor} rates={rates} />",
              "<BookingOptions tutor={tutor} rates={rates} />")

io.open(p, 'w', encoding='utf-8').write(s)
print('page reconciled')
