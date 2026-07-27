/**
 * Our vacancies — §6.13
 *
 * Scaffolded. The real implementation lands in a later task; this exists so the
 * route resolves, the shell renders, and navigation can be walked end to end.
 */

import { EmptyState } from '../../components/ui/Card';

export default function OrgVacancies() {
  return (
    <div className="mx-auto max-w-prose px-4 py-8">
      <h1 className="font-display text-display text-ink">Our vacancies</h1>
      <p className="mt-2 max-w-prose text-small text-slate">Post a vacancy and see who expressed interest. There is deliberately no applicant-tracking pipeline (decision 4).</p>
      <div className="mt-6">
        <EmptyState
          title="Not built yet"
          description="This screen is scaffolded. §6.13"
        />
      </div>
    </div>
  );
}
