/**
 * My students — §6.1
 *
 * Scaffolded. The real implementation lands in a later task; this exists so the
 * route resolves, the shell renders, and navigation can be walked end to end.
 */

import { EmptyState } from '../../components/ui/Card';

export default function Students() {
  return (
    <div className="mx-auto max-w-prose px-4 py-6">
      <h1 className="font-display text-display text-ink">My students</h1>
      <p className="mt-2 max-w-prose text-small text-slate">Student profiles you own. A child under 18 exists here and has no account of their own.</p>
      <div className="mt-6">
        <EmptyState
          title="Not built yet"
          description="This screen is scaffolded. §6.1"
        />
      </div>
    </div>
  );
}
