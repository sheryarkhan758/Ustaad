/**
 * Reports — §6.14
 *
 * Scaffolded. The real implementation lands in a later task; this exists so the
 * route resolves, the shell renders, and navigation can be walked end to end.
 */

import { EmptyState } from '../../components/ui/Card';

export default function AdminFlags() {
  return (
    <div className="mx-auto max-w-wide px-4 py-8">
      <h1 className="font-display text-display text-ink">Reports</h1>
      <p className="mt-2 max-w-prose text-small text-slate">The flag queue. A resolution needs a written reason and can only be made once.</p>
      <div className="mt-6">
        <EmptyState
          title="Not built yet"
          description="This screen is scaffolded. §6.14"
        />
      </div>
    </div>
  );
}
