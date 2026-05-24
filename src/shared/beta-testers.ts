/**
 * Beta tester roster.
 *
 * Source: signup form (Hebrew). Names preserved as submitted; field values
 * normalized to English keys for code use. The whitelist used by AuthContext
 * is DERIVED from this list, so editing this file is the single place that
 * controls who can use the app.
 *
 * Emails are stored lowercase; the whitelist check should also lowercase
 * the user's email before comparing.
 */

export type BetaTesterPlatform = 'android' | 'ios' | 'desktop';
export type BetaTesterEloRange = 'under_800' | '800_1200' | '1200_1800' | '1800_plus';
export type BetaTesterStage = 'alpha' | 'closed_beta' | 'open_beta';

export interface BetaTester {
  fullName: string;
  email: string;
  platforms: BetaTesterPlatform[];
  /** Beta-testing enthusiasm self-rating, 1–7. Null when the form left it blank. */
  enthusiasm: number | null;
  eloRange: BetaTesterEloRange;
  preferredStage: BetaTesterStage;
  /** Whether they want progress updates before the beta opens. Null when blank. */
  wantsUpdates: boolean | null;
}

export const BETA_TESTERS: BetaTester[] = [
  { fullName: 'עידן דוד',         email: 'idan4895@gmail.com',           platforms: ['android', 'desktop'], enthusiasm: 5, eloRange: '1800_plus',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'רואי מלול',         email: 'roi.melul@gmail.com',          platforms: ['android'],            enthusiasm: 7, eloRange: '800_1200',   preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'אביעד ברגר',        email: 'bergere091@gmail.com',         platforms: ['android'],            enthusiasm: 4, eloRange: '1200_1800',  preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'יאיר פארן',         email: 'ppparany@gmail.com',           platforms: ['android', 'desktop'], enthusiasm: 5, eloRange: '1800_plus',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'רם גלמידי',         email: 'galmidiram@gmail.com',         platforms: ['android', 'desktop'], enthusiasm: 4, eloRange: '1800_plus',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'צבי שיננזון',       email: 'zvit.com@gmail.com',           platforms: ['desktop'],            enthusiasm: 1, eloRange: '1200_1800',  preferredStage: 'alpha',       wantsUpdates: false },
  { fullName: 'איתן קנדל',         email: 'eytankandel@gmail.com',        platforms: ['ios'],                enthusiasm: 4, eloRange: '1800_plus',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'דביר סופן',         email: 'schrxupi@gmail.com',           platforms: ['android'],            enthusiasm: 7, eloRange: 'under_800',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'ינון פז גרינוולד',  email: 'ynwnpaz@gmail.com',            platforms: ['android'],            enthusiasm: 4, eloRange: '1800_plus',  preferredStage: 'alpha',       wantsUpdates: false },
  { fullName: 'יואב שילה',         email: 'yoavshilo2014@gmail.com',      platforms: ['ios'],                enthusiasm: 4, eloRange: '1200_1800',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'הלל גולד',          email: 'halell.gold9@gmail.com',       platforms: ['android'],            enthusiasm: 5, eloRange: '800_1200',   preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'מיכאל ש',           email: 'shkasta@post.bgu.ac.il',       platforms: ['android'],            enthusiasm: 6, eloRange: 'under_800',  preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'בן יעקב אגמון',     email: 'benyagmon@gmail.com',          platforms: ['android', 'desktop'], enthusiasm: 7, eloRange: '800_1200',   preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'עזרא קופל',         email: 'ezra.koppel@yahoo.com',        platforms: ['ios'],                enthusiasm: 3, eloRange: '1800_plus',  preferredStage: 'closed_beta', wantsUpdates: false },
  { fullName: 'יעקב',              email: 'yaakovzaks1@gmail.com',        platforms: ['android'],            enthusiasm: 2, eloRange: '800_1200',   preferredStage: 'closed_beta', wantsUpdates: false },
  { fullName: 'אברהם בר',          email: 'tcrvnkl@gmail.com',            platforms: ['android'],            enthusiasm: 4, eloRange: 'under_800',  preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'איתמר כהן',         email: 'itamar124812@gmail.com',       platforms: ['android'],            enthusiasm: 4, eloRange: '1800_plus',  preferredStage: 'closed_beta', wantsUpdates: null  },
  { fullName: 'שקד אוחנה',         email: 'shakedrohana@gmail.com',       platforms: ['android'],            enthusiasm: null, eloRange: 'under_800', preferredStage: 'alpha',     wantsUpdates: true  },
  { fullName: 'שמחה כץ',           email: 'a0522097876@gmail.com',        platforms: ['android'],            enthusiasm: 1, eloRange: '1200_1800',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'מאיר אלפסי',        email: 'meir.elfasy@gmail.com',        platforms: ['ios'],                enthusiasm: 4, eloRange: '800_1200',   preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'נתן שיק',           email: 'natannotfound218@gmail.com',   platforms: ['ios'],                enthusiasm: 4, eloRange: '1800_plus',  preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'אהרון קפלן',        email: 'azk08085@gmail.com',           platforms: ['android'],            enthusiasm: 3, eloRange: '1200_1800',  preferredStage: 'closed_beta', wantsUpdates: false },
  { fullName: 'חיים הררי',         email: 'hharari21@neveshmuel.org.il',  platforms: ['android'],            enthusiasm: 4, eloRange: '1200_1800',  preferredStage: 'closed_beta', wantsUpdates: true  },
  { fullName: 'קיריל כץ',          email: 'chesskirill@gmail.com',        platforms: ['ios', 'desktop'],     enthusiasm: 5, eloRange: '1800_plus',  preferredStage: 'alpha',       wantsUpdates: true  },
  { fullName: 'גיא צוריאל',        email: 'guy.zuriel@gmail.com',         platforms: ['ios'],                enthusiasm: 3, eloRange: '1800_plus',  preferredStage: 'open_beta',   wantsUpdates: false },
  { fullName: 'אריה וסטרייך',      email: 'ari.westreich@gmail.com',      platforms: ['ios', 'desktop'],     enthusiasm: 5, eloRange: '1200_1800',  preferredStage: 'alpha',       wantsUpdates: true  },
];

/** Email-only allowlist used by AuthContext. Lowercase, derived from BETA_TESTERS. */
export const BETA_WHITELIST_EMAILS: readonly string[] = BETA_TESTERS.map(t => t.email.toLowerCase());

/**
 * Manually granted beta access — for testers added outside the signup form
 * (e.g. friends, ad-hoc requests). Lowercase emails only.
 */
export const MANUAL_BETA_EMAILS: readonly string[] = [
  'bargoldshmidt@gmail.com',
  'ereztsiton@gmail.com',
  'tanton8787@gmail.com',
];

/**
 * Snapshot of every Base44 user account that existed when the closed-beta
 * gate went live (2026-05-11). These users are grandfathered in — they signed
 * up before the gate and shouldn't get locked out. Sourced via
 * `base44.entities.User.list()` (see scripts/dump-legacy-emails.ts).
 *
 * Do NOT remove entries; only append new ones if you discover stragglers.
 */
export const LEGACY_USERS_EMAILS: readonly string[] = [
  '68pgywky2z@privaterelay.appleid.com',
  '8nkv86kxd2@privaterelay.appleid.com',
  'back.yonatan@gmail.com',
  'capsule.stands@gmail.com',
  'chessthinkerpro@gmail.com',
  'cpsykv56w6@privaterelay.appleid.com',
  'fvqm695rr7@privaterelay.appleid.com',
  'gihan73118@pmdeal.com',
  'guykaplan17@gmail.com',
  'guywiernik@gmail.com',
  'hagajin358@pertok.com',
  'itaiinicos@gmail.com',
  'kidrazion@gmail.com',
  'kusimashelahem@gmail.com',
  'noamdi@wix.com',
  'ohadbachner@gmail.com',
  's7hk2nxn2w@privaterelay.appleid.com',
  'swwf9jx8qd@privaterelay.appleid.com',
  'talazenkot@gmail.com',
  'yaronk1982@gmail.com',
  'yk75qq6h9s@privaterelay.appleid.com',
  'ytouval@gmail.com',
  'yuval.i@taboola.com',
  'yuval.inc@gmail.com',
  'yuval.incze@naturalint.com',
  'yuval@chessdna.app',
  'yuval@gmail.com',
];

export function isWhitelistedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (
    BETA_WHITELIST_EMAILS.includes(normalized) ||
    LEGACY_USERS_EMAILS.includes(normalized) ||
    MANUAL_BETA_EMAILS.includes(normalized)
  );
}
