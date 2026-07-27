/**
 * Verifications — §6.6
 *
 * Scaffolded. The real implementation lands in a later task; this exists so the
 * route resolves, the shell renders, and navigation can be walked end to end.
 */

import { EmptyState } from '../../components/ui/Card';

export default function AdminVerifications() {
  return (
    <div className="mx-auto max-w-wide px-4 py-8">
      <h1 className="font-display text-display text-ink">Verifications</h1>
      <p className="mt-2 max-w-prose text-small text-slate">The queue. Every decision is attributed, reasoned, and written to the append-only audit log.</p>
      <div className="mt-6">
        <EmptyState
          title="Not built yet"
          description="This screen is scaffolded. §6.6"
        />
      </div>
    </div>
  );
}
