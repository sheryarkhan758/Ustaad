/**
 * `/styleguide` — every primitive, in **both directions, side by side**.
 *
 * ── Why side by side and not a toggle ──────────────────────────────────────
 * A toggle shows you one direction at a time, so a broken RTL layout is only
 * visible to somebody who thought to look. Rendering both at once makes the
 * breakage impossible to miss: a chevron pointing the wrong way, a chart axis
 * running backwards or a table whose first column has drifted to the wrong edge
 * shows up as an asymmetry between two panels that should mirror each other.
 *
 * That is the whole point of doing this before the feature screens exist.
 * Retrofitting RTL into finished components costs roughly double, and the way
 * it gets missed is that nobody opens the Urdu view until submission.
 *
 * Each panel is a real `dir` subtree with a real `lang`, so the browser applies
 * genuine bidirectional layout and the genuine font stack — not a CSS transform
 * pretending to be one.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionBar, Button } from '../components/ui/Button';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonCard,
  Table,
  Td,
  Th,
} from '../components/ui/Card';
import { Checkbox, Field, Input, Select, Textarea } from '../components/ui/Field';
import {
  ArrowBack,
  ArrowForward,
  Check,
  ChevronEnd,
  ChevronStart,
  Clock,
  Close,
  ExternalLink,
  Menu,
  Search,
  Warning,
} from '../components/ui/Icon';
import { Modal, Toast, ToastRegion } from '../components/ui/Modal';
import { UserQuote, UserText } from '../components/ui/UserText';
import { CurriculumPicker } from '../components/pickers/CurriculumPicker';
import { LocationPicker } from '../components/pickers/LocationPicker';
import { PrerequisiteBrowser } from '../components/pickers/PrerequisiteBrowser';
import { IdentityRecord, CompetencyRecord } from '../components/verification/VerificationRecord';
import { useFormat } from '../lib/format';

/* -------------------------------------------------------------------------
 * The dual-direction frame
 * ---------------------------------------------------------------------- */

/**
 * Renders its children twice — once LTR/English, once RTL/Urdu.
 *
 * `key` differs per panel so React does not reuse state between them: two
 * panels sharing a modal's open state would close both at once and hide
 * exactly the kind of bug this page exists to surface.
 */
function BothDirections({ children, stacked = false }) {
  const panel = (dir, lang, label) => (
    <div dir={dir} lang={lang} className="min-w-0 flex-1">
      <p
        dir="ltr"
        className="mb-2 font-mono text-caption uppercase tracking-wide text-slate-light"
      >
        {label}
      </p>
      <div className="rounded-card border border-dashed border-slate-line bg-paper/40 p-3">
        {typeof children === 'function' ? children(dir) : children}
      </div>
    </div>
  );

  return (
    <div className={`flex gap-4 ${stacked ? 'flex-col' : 'flex-col lg:flex-row'}`}>
      {panel('ltr', 'en', 'ltr · en')}
      {panel('rtl', 'ur', 'rtl · ur')}
    </div>
  );
}

function Section({ title, note, children }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-title text-ink">{title}</h2>
        {note ? <p className="mt-1 max-w-prose text-small text-slate">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

const SWATCHES = [
  ['ink', '#1B3A57', 'Primary text and actions', 'bg-ink'],
  ['verdigris', '#0F7B8A', 'Fills and accents — fails AA as text', 'bg-verdigris'],
  ['verdigris-deep', '#0A5D69', 'Teal text, AA-safe at ~6.4:1', 'bg-verdigris-deep'],
  ['slate', '#5A6E7F', 'Secondary text, rules', 'bg-slate'],
  ['paper', '#F1F4F7', 'Page ground', 'bg-paper'],
  ['seal', '#A8763E', 'Verification record only', 'bg-seal'],
  ['flag', '#A32F27', 'Errors and safety flags', 'bg-flag'],
];

/** Real content of the kind the platform receives — see `UserText`. */
const SAMPLE_REVIEW_ROMAN =
  'Ayesha baji waqt par aati hain aur mere bete ko ab samajh aa raha hai. Sirf pace thora tez hai.';
const SAMPLE_REVIEW_URDU =
  'استاد صاحبہ وقت پر آتی ہیں اور بچے کو بہت اچھی طرح سمجھاتی ہیں۔ حساب میں واضح بہتری آئی ہے۔';

export default function Styleguide() {
  const { t } = useTranslation(['common', 'search']);
  const fmt = useFormat();
  const [modalOpen, setModalOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  // The pickers are stateful, so the styleguide holds their state — which also
  // makes the cascade's clearing behaviour visible when you change a parent.
  const [location, setLocation] = useState({
    provinceId: 'sindh',
    cityId: 'karachi',
    areaId: 'karachi-clifton',
    includeAdjacent: true,
  });
  const [curriculum, setCurriculum] = useState({
    subjectId: 'mathematics',
    levelId: 'matric',
    boardId: 'sindh-board',
    topicIds: ['math-matric-sindh-quadratic-equations'],
  });

  return (
    <div className="mx-auto max-w-wide space-y-12 px-4 py-8">
      <header>
        <p className="text-caption font-semibold uppercase tracking-wide text-verdigris-deep">
          Design system
        </p>
        <h1 className="mt-1 font-display text-display text-ink">Ustaad.com primitives</h1>
        <p className="mt-2 max-w-prose text-small text-slate">
          Every primitive is rendered twice — left-to-right and right-to-left — so layout breakage
          is visible here rather than at submission. Tokens live in{' '}
          <code className="rounded bg-paper-sunk px-1 font-mono text-caption">
            tailwind.config.js
          </code>
          ; no component writes a raw hex value, and{' '}
          <code className="rounded bg-paper-sunk px-1 font-mono text-caption">
            npm run check:logical
          </code>{' '}
          fails the build on a physical direction property.
        </p>
      </header>

      {/* --- Palette ------------------------------------------------------ */}
      <Section
        title="Palette"
        note="Anchored on the specification's navy and teal. Two teals, because #0F7B8A measures about 4.1:1 on white and fails AA for body text — fills use one, text uses the other."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SWATCHES.map(([name, hex, role, bg]) => (
            <div key={name} className="overflow-hidden rounded-card border border-slate-line">
              <div className={`h-16 ${bg}`} />
              <div className="bg-white p-3">
                <p className="font-mono text-caption text-ink">{name}</p>
                <p className="font-mono text-caption tnum text-slate">{hex}</p>
                <p className="mt-1 text-caption text-slate">{role}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* --- Icons — the thing that most visibly breaks -------------------- */}
      <Section
        title="Icons"
        note="Directional icons mirror; the rest must not. A back arrow still pointing left in Urdu sends the reader forwards — but a mirrored tick, clock or search lens just looks wrong to everyone. Compare the two panels: the top row should differ, the bottom row should be identical."
      >
        <BothDirections>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-verdigris-deep">
                Mirrors
              </p>
              <div className="flex flex-wrap items-center gap-4 text-ink">
                <ArrowBack title="Back" />
                <ArrowForward title="Forward" />
                <ChevronStart />
                <ChevronEnd />
                <ExternalLink />
              </div>
            </div>
            <div>
              <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-slate">
                Does not mirror
              </p>
              <div className="flex flex-wrap items-center gap-4 text-ink">
                <Check />
                <Close />
                <Search />
                <Clock />
                <Warning />
                <Menu />
              </div>
            </div>
          </div>
        </BothDirections>
      </Section>

      {/* --- Type --------------------------------------------------------- */}
      <Section
        title="Type"
        note="Source Serif 4 for display, IBM Plex Sans for body. Urdu uses IBM Plex Sans Arabic (Naskh) for anything small or interactive, and Noto Nastaliq Urdu for display only — Nastaliq needs 2.4 line-height and is too slow to read at control size."
      >
        <BothDirections>
          {(dir) => (
            <div className="space-y-3">
              {dir === 'ltr' ? (
                <>
                  <p className="font-display text-display text-ink">Verified tutors, on record</p>
                  <p className="text-body text-ink">
                    Body copy at 1rem with 1.5 line-height. Never smaller than 16px on a control.
                  </p>
                  <p className="text-small text-slate">Small — captions, metadata, hints.</p>
                </>
              ) : (
                <>
                  <p className="u-display text-nastaliq-display text-ink">تصدیق شدہ اساتذہ</p>
                  <p className="text-urdu-body text-ink">
                    یہ نسخ ہے، نستعلیق نہیں۔ چھوٹے سائز اور فارم کے لیے نسخ زیادہ پڑھنے کے قابل ہے۔
                  </p>
                  <p className="text-urdu-small text-slate">چھوٹا متن — تفصیلات اور اشارے۔</p>
                </>
              )}
              <p className="font-mono text-small tnum text-ink">
                {fmt.paisa(1_800_000)} · {fmt.date('2026-07-27')}
              </p>
            </div>
          )}
        </BothDirections>
      </Section>

      {/* --- Formatting ---------------------------------------------------- */}
      <Section
        title="Numbers, dates and currency"
        note="One helper, and numerals stay Western-Arabic in both languages (FR-27.6). An amount that changed digit shapes between views is an amount somebody misreads against a bank statement."
      >
        <Card>
          <CardBody>
            <Table caption="Formatting examples">
              <thead>
                <tr>
                  <Th>Call</Th>
                  <Th numeric>Result</Th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['fmt.paisa(1_800_000)', fmt.paisa(1_800_000)],
                  ['fmt.paisa(250_000)', fmt.paisa(250_000)],
                  ['fmt.number(18000)', fmt.number(18000)],
                  ['fmt.date("2026-07-27")', fmt.date('2026-07-27')],
                  ['fmt.percent(0.87)', fmt.percent(0.87)],
                ].map(([call, value]) => (
                  <tr key={call}>
                    <Td>
                      <code className="font-mono text-caption">{call}</code>
                    </Td>
                    <Td numeric>{value}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </Section>

      {/* --- User content — the hard rule ---------------------------------- */}
      <Section
        title="User-generated content"
        note="Never machine-translated (decision 13, FR-27.5). Both reviews below render byte-for-byte in both panels — the Roman Urdu one reads left-to-right even in the RTL panel, because dir='auto' follows the script rather than the page."
      >
        <BothDirections>
          <div className="space-y-4">
            <UserQuote cite="A parent, Clifton">{SAMPLE_REVIEW_ROMAN}</UserQuote>
            <UserQuote cite="ایک والدہ، گلشن اقبال">{SAMPLE_REVIEW_URDU}</UserQuote>
            <UserText className="text-small text-slate">
              Bohat achi teacher hain — ریاضی میں bohat improvement hui hai. 5/5.
            </UserText>
          </div>
        </BothDirections>
      </Section>

      {/* --- The signature ------------------------------------------------ */}
      <Section
        title="Verification record — the signature element"
        note="Not a badge. Itemised checks with dates, the approving administrator named, and the limit of the claim printed on the card itself. The seal ochre appears here and nowhere else."
      >
        <BothDirections>
          <div className="space-y-4">
            <IdentityRecord
              artefacts={[
                { artefact: 'cnic', checkedOn: '2025-11-30' },
                { artefact: 'degree', checkedOn: '2025-11-30' },
              ]}
              decidedBy="Platform Administrator"
              decidedAt="2025-11-30T10:24:00.000Z"
            />
            <CompetencyRecord
              topic="Organic Chemistry"
              outcome="passed"
              assessedAt="2026-03-14T09:00:00.000Z"
              expiresOn="2027-03-14"
            />
          </div>
        </BothDirections>
      </Section>

      {/* --- Buttons ------------------------------------------------------ */}
      <Section
        title="Buttons"
        note="Primary is 48px tall, everything else 44px — the WCAG 2.5.5 floor. Icon and label order follows direction automatically because the row is a flex container, not a float."
      >
        <BothDirections>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary">{t('action.confirm')}</Button>
            <Button variant="secondary">{t('action.cancel')}</Button>
            <Button variant="accent">
              <ArrowForward size="sm" />
              {t('action.next')}
            </Button>
            <Button variant="ghost">
              <ArrowBack size="sm" />
              {t('action.back')}
            </Button>
            <Button variant="danger">{t('action.dismiss')}</Button>
            <Button variant="primary" busy>
              {t('action.save')}
            </Button>
            <Button variant="secondary" disabled>
              {t('action.close')}
            </Button>
          </div>
        </BothDirections>
      </Section>

      {/* --- Inputs ------------------------------------------------------- */}
      <Section
        title="Inputs"
        note="Watch the required marker and the select chevron. Both must sit on the reading-end edge — the marker uses ms-*, and the chevron is the one documented exception, since background-position has no logical form."
      >
        <BothDirections>
          {(dir) => (
            <div className="space-y-5">
              <Field
                label={dir === 'ltr' ? 'Full name' : 'پورا نام'}
                required
                hint={dir === 'ltr' ? 'As it appears on your CNIC.' : 'جیسا شناختی کارڈ پر ہے۔'}
              >
                {(props) => <Input {...props} placeholder={dir === 'ltr' ? 'Ayesha Siddiqui' : 'عائشہ صدیقی'} />}
              </Field>

              <Field label={t('search:filters.city')} required>
                {(props) => (
                  <Select {...props} defaultValue="karachi">
                    <option value="karachi">{dir === 'ltr' ? 'Karachi' : 'کراچی'}</option>
                    <option value="lahore">{dir === 'ltr' ? 'Lahore' : 'لاہور'}</option>
                  </Select>
                )}
              </Field>

              <Field
                label={t('search:filters.budget')}
                error={dir === 'ltr' ? 'Enter a whole number of rupees.' : 'روپے کی پوری رقم لکھیں۔'}
              >
                {(props) => <Input {...props} inputMode="numeric" defaultValue="18,000.50" />}
              </Field>

              <Field label={dir === 'ltr' ? 'Biography' : 'تعارف'}>
                {(props) => <Textarea {...props} rows={3} />}
              </Field>

              <Checkbox
                label={t('search:filters.genderFemale')}
                hint={t('search:genderNote')}
              />
            </div>
          )}
        </BothDirections>
      </Section>

      {/* --- Badges ------------------------------------------------------- */}
      <Section
        title="Badges"
        note="Status markers only. There is deliberately no 'Verified' tone — verification is a record card, and a pill claiming it is what SEC-6 exists to prevent."
      >
        <BothDirections>
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">{t('booking:status.requested', { defaultValue: 'Requested' })}</Badge>
            <Badge tone="info">
              <Clock size="sm" />
              {t('common:state.loading')}
            </Badge>
            <Badge tone="settled">
              <Check size="sm" />
              Settled
            </Badge>
            <Badge tone="warning">
              <Warning size="sm" />
              Lapsing soon
            </Badge>
            <Badge tone="flag">Reported</Badge>
          </div>
        </BothDirections>
      </Section>

      {/* --- Table -------------------------------------------------------- */}
      <Section
        title="Table"
        note="Column order follows direction: in the RTL panel the first column sits on the reading-start edge, which is where an Urdu reader looks first. Numeric columns align to the end edge in both, so the digits still stack into a clean column."
      >
        <BothDirections stacked>
          <Table caption="Payment records for this engagement">
            <thead>
              <tr>
                <Th>Cycle</Th>
                <Th>Status</Th>
                <Th numeric>Agreed</Th>
              </tr>
            </thead>
            <tbody>
              {[
                ['2026-05', 'settled', 1_800_000],
                ['2026-06', 'info', 1_800_000],
                ['2026-07', 'flag', 300_000],
              ].map(([cycle, tone, amount]) => (
                <tr key={cycle}>
                  <Td>{cycle}</Td>
                  <Td>
                    <Badge tone={tone}>{tone}</Badge>
                  </Td>
                  <Td numeric>{fmt.paisa(amount)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </BothDirections>
      </Section>

      {/* --- States ------------------------------------------------------- */}
      <Section title="Empty, error and loading">
        <BothDirections>
          <div className="space-y-4">
            <EmptyState
              title={t('search:empty.title')}
              description={t('search:empty.body')}
              action={
                <Button variant="accent" size="sm">
                  {t('search:filters.clear')}
                </Button>
              }
            />
            <ErrorState
              title={t('state.errorTitle')}
              error={{ message: t('state.networkError') }}
              onRetry={() => {}}
            />
            <SkeletonCard label={t('state.loading')} />
            <div className="space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        </BothDirections>
      </Section>

      {/* --- Location picker ---------------------------------------------- */}
      <Section
        title="Location picker"
        note="Province → city → area, cascading. Area is the finest granularity in this product: there is no map, no pin and no GPS, and 'include neighbouring areas' reads a hand-curated adjacency list rather than a radius. Change the province and watch the city and area clear — a form still holding a Karachi area after switching to Punjab submits something the server has to reject."
      >
        <BothDirections stacked>
          <LocationPicker value={location} onChange={setLocation} />
        </BothDirections>
        <pre className="overflow-x-auto rounded-card border border-slate-line bg-paper p-3 font-mono text-caption text-slate">
          {JSON.stringify(location, null, 2)}
        </pre>
      </Section>

      {/* --- Curriculum picker -------------------------------------------- */}
      <Section
        title="Curriculum picker"
        note="Subject → level → board → topics. Board is rendered at the same weight as subject, as cards rather than a dropdown, because decision 5 makes it a choice rather than a refinement: a Sindh Board tutor and a Cambridge tutor are teaching different courses. Change the board and the topic selection clears."
      >
        <BothDirections stacked>
          <CurriculumPicker value={curriculum} onChange={setCurriculum} />
        </BothDirections>
        <pre className="overflow-x-auto rounded-card border border-slate-line bg-paper p-3 font-mono text-caption text-slate">
          {JSON.stringify(curriculum, null, 2)}
        </pre>
      </Section>

      {/* --- Prerequisite browser ------------------------------------------ */}
      <Section
        title="Prerequisite browser"
        note="The specification's central worked example (§2.4): quadratic equations depends on algebraic factorisation, which depends on signed-number arithmetic. Rendered as a nested list rather than a node diagram — arrows are unreadable at 320px and invisible to a screen reader, and 'this rests on that' is exactly what a nested list means."
      >
        <BothDirections stacked>
          <PrerequisiteBrowser topicIds={curriculum.topicIds} />
        </BothDirections>
      </Section>

      {/* --- Overlays ----------------------------------------------------- */}
      <Section
        title="Modal and toast"
        note="The modal is a native <dialog>, so focus trapping and Escape come from the platform. The close control sits on the reading-end edge in both directions because the header is a flex row with justify-between."
      >
        <Card>
          <CardHeader title="Try them" subtitle="Both render inside the current page direction" />
          <CardBody className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setModalOpen(true)}>
              Open modal
            </Button>
            <Button variant="secondary" onClick={() => setToastVisible(true)}>
              Show toast
            </Button>
          </CardBody>
        </Card>

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Resolve this report"
          description="Your reason is recorded permanently and cannot be edited afterwards."
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                {t('action.cancel')}
              </Button>
              <Button variant="primary" onClick={() => setModalOpen(false)}>
                {t('action.confirm')}
              </Button>
            </>
          }
        >
          <Field label="Reason" required hint="At least 15 characters.">
            {(props) => <Textarea {...props} />}
          </Field>
        </Modal>

        {toastVisible ? (
          <ToastRegion>
            <Toast
              tone="settled"
              title="Report recorded"
              description="It is now in the administrator queue."
              onDismiss={() => setToastVisible(false)}
            />
          </ToastRegion>
        ) : null}
      </Section>

      {/* --- Action bar --------------------------------------------------- */}
      <Section
        title="Bottom action bar"
        note="Fixed within thumb reach below 640px, inline above it. Button order reverses with direction because it is a flex row."
      >
        <ActionBar>
          <Button variant="secondary" fullWidth>
            {t('action.back')}
          </Button>
          <Button variant="primary" fullWidth>
            {t('action.confirm')}
          </Button>
        </ActionBar>
      </Section>
    </div>
  );
}
