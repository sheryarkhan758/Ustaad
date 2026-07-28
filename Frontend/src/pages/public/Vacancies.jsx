/**
 * Vacancies — §6.13
 *
 * Scaffolded. The real implementation lands in a later task; this exists so the
 * route resolves, the shell renders, and navigation can be walked end to end.
 */

import { EmptyState } from '../../components/ui/Card';

export default function Vacancies() {
  return (
    <div className="mx-auto max-w-prose px-4 py-6">
      <h1 className="font-display text-display text-ink">Vacancies</h1>
      <p className="mt-2 max-w-prose text-small text-slate">Publicly browsable (FR-13.6). Open vacancies from approved organisations only.</p>
      <div className="mt-6">
        <EmptyState
          title="Not built yet"
          description="This screen is scaffolded. §6.13"
        />
      </div>
    </div>
  );
}
