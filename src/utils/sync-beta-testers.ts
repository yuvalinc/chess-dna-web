/**
 * Idempotent sync of the static BETA_TESTERS list AND MANUAL_BETA_EMAILS
 * into the BetaTester entity. Each entry is inserted only if no existing
 * record matches their email.
 *
 * Admin-only (RLS gates the create at the server). Safe to run on every
 * AnalyticsAdmin mount — existing rows are skipped.
 */
import { base44 } from '@/api/base44Client';
import { BETA_TESTERS, MANUAL_BETA_EMAILS } from '@shared/beta-testers';

const entities = base44.entities as Record<string, any>;

export interface BetaTesterSyncResult {
  total: number;
  created: number;
  skipped: number;
  errors: Array<{ email: string; error: string }>;
}

export async function syncBetaTestersToBase44(
  onProgress?: (msg: string) => void,
): Promise<BetaTesterSyncResult> {
  // Combine signup-form testers with manually-granted emails. Manual entries
  // have no profile data, so they get email-as-name and an "(manual)" stage
  // marker so the admin table makes it clear where they came from.
  const allEntries: Array<{
    email: string;
    fullName: string;
    platforms: string[];
    enthusiasm: number | null;
    eloRange: string | null;
    preferredStage: string;
    wantsUpdates: boolean | null;
  }> = [
    ...BETA_TESTERS.map(t => ({
      email: t.email.toLowerCase(),
      fullName: t.fullName,
      platforms: t.platforms as string[],
      enthusiasm: t.enthusiasm,
      eloRange: t.eloRange as string,
      preferredStage: t.preferredStage as string,
      wantsUpdates: t.wantsUpdates,
    })),
    ...MANUAL_BETA_EMAILS.map(email => ({
      email: email.toLowerCase(),
      fullName: email,
      platforms: [] as string[],
      enthusiasm: null,
      eloRange: null,
      preferredStage: 'manual',
      wantsUpdates: null,
    })),
  ];

  const result: BetaTesterSyncResult = {
    total: allEntries.length,
    created: 0,
    skipped: 0,
    errors: [],
  };

  for (const entry of allEntries) {
    const { email } = entry;
    onProgress?.(`Checking ${email}…`);
    try {
      const existing = await entities.BetaTester.filter({ email });
      if (Array.isArray(existing) && existing.length > 0) {
        result.skipped++;
        continue;
      }
      await entities.BetaTester.create({
        email,
        fullName: entry.fullName,
        platforms: entry.platforms,
        enthusiasm: entry.enthusiasm ?? undefined,
        eloRange: entry.eloRange ?? undefined,
        preferredStage: entry.preferredStage,
        wantsUpdates: entry.wantsUpdates ?? undefined,
      });
      result.created++;
    } catch (err) {
      result.errors.push({
        email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
