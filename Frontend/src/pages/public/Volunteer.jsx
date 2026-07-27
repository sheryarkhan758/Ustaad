/**
 * Volunteer as a tutor — §6.33
 *
 * Scaffolded. The real implementation lands in a later task; this exists so the
 * route resolves, the shell renders, and navigation can be walked end to end.
 */

import { EmptyState } from '../../components/ui/Card';

export default function Volunteer() {
  return (
    <div className="mx-auto max-w-prose px-4 py-8">
      <h1 className="font-display text-display text-ink">Volunteer as a tutor</h1>
      <p className="mt-2 max-w-prose text-small text-slate">A public form needing no account. A volunteer is verified on exactly the same basis as a paid tutor (FR-33.10).</p>
      <div className="mt-6">
        <EmptyState
          title="Not built yet"
          description="This screen is scaffolded. §6.33"
        />
      </div>
    </div>
  );
}
