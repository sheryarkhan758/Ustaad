/**
 * The landing page.
 *
 * The first thing a parent sees, so it does the product's actual job rather
 * than selling: it states plainly what the platform checks, shows the record
 * artefact, and puts search one tap away. No testimonial carousel, no counter
 * ticking up — this is meant to read as an institution that keeps records.
 */

import { Link } from 'react-router-dom';

import { Card, CardBody } from '../../components/ui/Card';
import { GuestCredentials } from '../../components/demo/GuestCredentials';
import { IdentityRecord } from '../../components/verification/VerificationRecord';

export default function Landing() {
  return (
    <div>
      <section className="bg-ink text-white">
        <div className="mx-auto max-w-wide px-4 py-12 sm:py-16">
          <div className="max-w-prose">
            <h1 className="font-display text-display-lg">
              Tutors whose identity we checked ourselves.
            </h1>
            <p className="mt-4 text-body text-white/85">
              Ustaad.com does not take a tutor&rsquo;s word for their qualifications, and it does
              not take a third party&rsquo;s. An administrator checks the documents, records exactly
              which ones, and signs the record.
            </p>
            <p className="mt-3 text-small text-white/70">
              We do not perform police or background checks, and we say so on every record.
            </p>

            {/*
              The diagnostic leads (§6.10). Most families arrive able to name a
              symptom — "she is weak in Maths" — and not the gap, and a search
              form asks them to convert one into the other before they can use
              the product at all. The conversation does that conversion, so it
              is the primary action and search is the one beside it, for
              somebody who already knows what they are looking for.
            */}
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/intake"
                className="inline-flex min-h-tap-lg items-center justify-center rounded-control bg-verdigris px-5 text-small font-medium text-white hover:bg-verdigris-deep"
              >
                Describe the difficulty
              </Link>
              {/*
                The home-tuition pathway, beside the diagnostic rather than
                below it — FR-29.1 places them together, and decision 15 is that
                this is the platform's primary case, not a refinement of search.
                Same weight as the button next to it, because for the families
                it serves it is not an alternative route to the same thing: it
                is the only route to any of it (§2.1).
              */}
              <Link
                to="/home-tuition"
                className="inline-flex min-h-tap-lg items-center justify-center rounded-control bg-verdigris px-5 text-small font-medium text-white hover:bg-verdigris-deep"
              >
                Home tuition, female tutor
              </Link>
              <Link
                to="/search"
                className="inline-flex min-h-tap items-center justify-center rounded-control border border-white/25 px-5 text-small font-medium text-white hover:bg-white/10"
              >
                Search tutors yourself
              </Link>
              <Link
                to="/demo"
                className="inline-flex min-h-tap items-center justify-center rounded-control border border-white/25 px-5 text-small font-medium text-white hover:bg-white/10"
              >
                See it work
              </Link>
            </div>

            <p className="mt-3 text-caption text-white/70">
              The difficulty a family names is usually not the one that needs teaching. Three or
              four questions is normally enough to find the topic underneath it.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-wide px-4 py-12">
        <div className="grid gap-8 md:grid-cols-2 md:items-start">
          <div>
            <h2 className="font-display text-title text-ink">What a verification looks like</h2>
            <p className="mt-2 max-w-prose text-small text-slate">
              Every verified tutor carries a record like this one. It names the artefacts that were
              checked, the date each was checked, and the administrator who approved it — and it
              states the limit of what the platform can claim.
            </p>

            <div className="mt-6 space-y-3">
              {[
                ['Itemised', 'One line per document, each with its own date.'],
                ['Attributed', 'The approving administrator is named on the record.'],
                ['Honest about its limits', 'What was not checked is printed on the card.'],
                ['Two tracks, never merged', 'Identity and subject competency stay separate.'],
              ].map(([title, body]) => (
                <div key={title} className="flex gap-3">
                  <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-verdigris" />
                  <p className="text-small text-ink">
                    <span className="font-semibold">{title}.</span>{' '}
                    <span className="text-slate">{body}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>

          <IdentityRecord
            artefacts={[
              { artefact: 'cnic', checkedOn: '2025-11-30' },
              { artefact: 'degree', checkedOn: '2025-11-30' },
            ]}
            decidedBy="Platform Administrator"
            decidedAt="2025-11-30T10:24:00.000Z"
          />
        </div>
      </section>

      <section className="border-t border-slate-line bg-white">
        <div className="mx-auto grid max-w-wide gap-4 px-4 py-12 sm:grid-cols-3">
          {[
            {
              title: 'She sets the conditions',
              body: 'A tutor states whether she teaches only female students, whether a guardian must be present, and which areas she will travel to. The system enforces those — it does not merely display them.',
            },
            {
              title: 'Rates you can compare',
              body: 'Monthly, hourly, per session and group rates are all shown in comparable terms, so a lower number is actually a lower number.',
            },
            {
              title: 'We record, we do not collect',
              body: 'Ustaad.com records what was agreed and what both parties confirm was paid. It does not process, hold or transfer money.',
            },
          ].map((item) => (
            <Card key={item.title}>
              <CardBody>
                <h3 className="font-display text-subtitle text-ink">{item.title}</h3>
                <p className="mt-2 text-small text-slate">{item.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      {/*
        Guest credentials, in demonstration mode only (§6.15). Renders nothing —
        and compiles to nothing — when `VITE_DEMO_MODE` is unset, so a
        deployment that is not a demonstration does not carry the strings.
      */}
      <section className="border-t border-slate-line bg-paper">
        <div className="mx-auto max-w-wide px-4 py-8">
          <GuestCredentials />
        </div>
      </section>
    </div>
  );
}
