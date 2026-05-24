/**
 * One-shot seed script for the BetaTester entity.
 * Runs via `cat scripts/seed-beta-testers.ts | npx base44 exec` so the SDK
 * authenticates as the CLI's logged-in admin (the dev preview can't pass
 * the admin-only RLS gate because it has no real Base44 token).
 *
 * Idempotent — emails already in BetaTester are skipped.
 */
const BETA_TESTERS = [
  { fullName: 'עידן דוד',         email: 'idan4895@gmail.com',           platforms: ['android', 'desktop'], enthusiasm: 5,    eloRange: '1800_plus',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'רואי מלול',         email: 'roi.melul@gmail.com',          platforms: ['android'],            enthusiasm: 7,    eloRange: '800_1200',   preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'אביעד ברגר',        email: 'bergere091@gmail.com',         platforms: ['android'],            enthusiasm: 4,    eloRange: '1200_1800',  preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'יאיר פארן',         email: 'ppparany@gmail.com',           platforms: ['android', 'desktop'], enthusiasm: 5,    eloRange: '1800_plus',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'רם גלמידי',         email: 'galmidiram@gmail.com',         platforms: ['android', 'desktop'], enthusiasm: 4,    eloRange: '1800_plus',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'צבי שיננזון',       email: 'zvit.com@gmail.com',           platforms: ['desktop'],            enthusiasm: 1,    eloRange: '1200_1800',  preferredStage: 'alpha',       wantsUpdates: false },
  { fullName: 'איתן קנדל',         email: 'eytankandel@gmail.com',        platforms: ['ios'],                enthusiasm: 4,    eloRange: '1800_plus',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'דביר סופן',         email: 'schrxupi@gmail.com',           platforms: ['android'],            enthusiasm: 7,    eloRange: 'under_800',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'ינון פז גרינוולד',  email: 'ynwnpaz@gmail.com',            platforms: ['android'],            enthusiasm: 4,    eloRange: '1800_plus',  preferredStage: 'alpha',       wantsUpdates: false },
  { fullName: 'יואב שילה',         email: 'yoavshilo2014@gmail.com',      platforms: ['ios'],                enthusiasm: 4,    eloRange: '1200_1800',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'הלל גולד',          email: 'halell.gold9@gmail.com',       platforms: ['android'],            enthusiasm: 5,    eloRange: '800_1200',   preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'מיכאל ש',           email: 'shkasta@post.bgu.ac.il',       platforms: ['android'],            enthusiasm: 6,    eloRange: 'under_800',  preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'בן יעקב אגמון',     email: 'benyagmon@gmail.com',          platforms: ['android', 'desktop'], enthusiasm: 7,    eloRange: '800_1200',   preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'עזרא קופל',         email: 'ezra.koppel@yahoo.com',        platforms: ['ios'],                enthusiasm: 3,    eloRange: '1800_plus',  preferredStage: 'closed_beta', wantsUpdates: false },
  { fullName: 'יעקב',              email: 'yaakovzaks1@gmail.com',        platforms: ['android'],            enthusiasm: 2,    eloRange: '800_1200',   preferredStage: 'closed_beta', wantsUpdates: false },
  { fullName: 'אברהם בר',          email: 'tcrvnkl@gmail.com',            platforms: ['android'],            enthusiasm: 4,    eloRange: 'under_800',  preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'איתמר כהן',         email: 'itamar124812@gmail.com',       platforms: ['android'],            enthusiasm: 4,    eloRange: '1800_plus',  preferredStage: 'closed_beta', wantsUpdates: null  },
  { fullName: 'שקד אוחנה',         email: 'shakedrohana@gmail.com',       platforms: ['android'],            enthusiasm: null, eloRange: 'under_800',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'שמחה כץ',           email: 'a0522097876@gmail.com',        platforms: ['android'],            enthusiasm: 1,    eloRange: '1200_1800',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'מאיר אלפסי',        email: 'meir.elfasy@gmail.com',        platforms: ['ios'],                enthusiasm: 4,    eloRange: '800_1200',   preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'נתן שיק',           email: 'natannotfound218@gmail.com',   platforms: ['ios'],                enthusiasm: 4,    eloRange: '1800_plus',  preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'אהרון קפלן',        email: 'azk08085@gmail.com',           platforms: ['android'],            enthusiasm: 3,    eloRange: '1200_1800',  preferredStage: 'closed_beta', wantsUpdates: false },
  { fullName: 'חיים הררי',         email: 'hharari21@neveshmuel.org.il',  platforms: ['android'],            enthusiasm: 4,    eloRange: '1200_1800',  preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'קיריל כץ',          email: 'chesskirill@gmail.com',        platforms: ['ios', 'desktop'],     enthusiasm: 5,    eloRange: '1800_plus',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'גיא צוריאל',        email: 'guy.zuriel@gmail.com',         platforms: ['ios'],                enthusiasm: 3,    eloRange: '1800_plus',  preferredStage: 'open_beta',   wantsUpdates: false },
  { fullName: 'אריה וסטרייך',      email: 'ari.westreich@gmail.com',      platforms: ['ios', 'desktop'],     enthusiasm: 5,    eloRange: '1200_1800',  preferredStage: 'alpha',       wantsUpdates: true  },
];

let created = 0, skipped = 0;
const errors: string[] = [];

for (const t of BETA_TESTERS) {
  const email = t.email.toLowerCase();
  try {
    const existing = await base44.entities.BetaTester.filter({ email });
    if (Array.isArray(existing) && existing.length > 0) {
      skipped++;
      console.log(`skip  ${email}`);
      continue;
    }
    await base44.entities.BetaTester.create({
      email,
      fullName: t.fullName,
      platforms: t.platforms,
      enthusiasm: t.enthusiasm ?? undefined,
      eloRange: t.eloRange,
      preferredStage: t.preferredStage,
      wantsUpdates: t.wantsUpdates ?? undefined,
    });
    created++;
    console.log(`create ${email}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`${email}: ${msg}`);
    console.error(`error ${email}: ${msg}`);
  }
}

console.log(`\nDone — total ${BETA_TESTERS.length} · created ${created} · skipped ${skipped} · errors ${errors.length}`);
if (errors.length > 0) {
  console.log('\nErrors:');
  errors.forEach(e => console.log('  ' + e));
}
