import type { TrapDefinition } from '@shared/types/patterns';

/**
 * Curated database of well-known opening traps.
 *
 * Each trap lists one or more SAN signatures — a prefix of moves that
 * identifies the trap line. A game matches a trap if any signature is
 * a prefix of the game's move list.
 *
 * Signatures are kept as short as possible while remaining distinctive,
 * so common transpositions still match.
 */
export const OPENING_TRAPS: TrapDefinition[] = [
  {
    id: 'wayward-queen',
    name: 'Wayward Queen',
    setterSide: 'white',
    ecoCodes: ['C20'],
    signatures: [
      ['e4', 'e5', 'Qh5'],
      ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5'],
      ['e4', 'e5', 'Bc4', 'Bc5', 'Qh5'],
    ],
    description:
      "White brings the queen out early (Qh5) hoping for Scholar's Mate. Strong against beginners, easily refuted with ...g6 and ...Nf6.",
  },
  {
    id: 'stafford-gambit',
    name: 'Stafford Gambit',
    setterSide: 'black',
    ecoCodes: ['C42'],
    signatures: [
      ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'Nc6'],
    ],
    description:
      'After 3.Nxe5, Black plays 3...Nc6 instead of recapturing — a pawn sacrifice for sharp piece play and well-known traps.',
  },
  {
    id: 'englund-gambit',
    name: 'Englund Gambit',
    setterSide: 'black',
    ecoCodes: ['A40'],
    signatures: [
      ['d4', 'e5'],
    ],
    description:
      'Black offers the e-pawn against 1.d4 hoping for tactical play and the Englund Trap (...Qb4+ winning a piece).',
  },
  {
    id: 'kings-gambit',
    name: "King's Gambit",
    setterSide: 'white',
    ecoCodes: ['C30', 'C31', 'C32', 'C33', 'C34', 'C35', 'C36', 'C37', 'C38', 'C39'],
    signatures: [
      ['e4', 'e5', 'f4'],
    ],
    description:
      "White sacrifices the f-pawn for rapid development and an attack on f7. Romantic-era favourite with many sharp lines.",
  },
  {
    id: 'fried-liver',
    name: 'Fried Liver Attack',
    setterSide: 'white',
    ecoCodes: ['C57'],
    signatures: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5'],
    ],
    description:
      "White lunges Ng5 hitting f7. If Black takes back with the knight after exd5, Nxf7 leads to a brutal king hunt.",
  },
  {
    id: 'legal-trap',
    name: 'Légal Trap',
    setterSide: 'white',
    ecoCodes: ['C41'],
    signatures: [
      ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'd6', 'Nc3', 'Bg4'],
    ],
    description:
      'White sacrifices the queen via Nxe5! exploiting the pinned Bg4 — ending in mate with bishop, knight, and pawn.',
  },
  {
    id: 'halloween-gambit',
    name: 'Halloween Gambit',
    setterSide: 'white',
    ecoCodes: ['C46'],
    signatures: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6', 'Nxe5'],
    ],
    description:
      'Wild knight sacrifice 4.Nxe5 in the Four Knights, going for a massive pawn centre and quick king-side attack.',
  },
  {
    id: 'blackburne-shilling',
    name: 'Blackburne Shilling Gambit',
    setterSide: 'black',
    ecoCodes: ['C50'],
    signatures: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4'],
    ],
    description:
      "Black baits Nxe5?? with the awkward-looking 3...Nd4. If White takes, 4...Qg5 wins material via the f2 fork.",
  },
  {
    id: 'elephant-gambit',
    name: 'Elephant Gambit',
    setterSide: 'black',
    ecoCodes: ['C40'],
    signatures: [
      ['e4', 'e5', 'Nf3', 'd5'],
    ],
    description:
      'Black sacrifices the d-pawn after 1.e4 e5 2.Nf3 d5. Surprise weapon — dubious but tactically tricky for unprepared opponents.',
  },
  {
    id: 'fishing-pole',
    name: 'Fishing Pole Trap',
    setterSide: 'black',
    ecoCodes: ['C65'],
    signatures: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Ng4'],
    ],
    description:
      'Black lures the h-pawn with ...Ng4 and ...h5 in the Berlin Ruy Lopez. If White grabs the knight, ...hxg4 opens the h-file for mate.',
  },
  {
    id: 'lasker-trap',
    name: 'Lasker Trap',
    setterSide: 'black',
    ecoCodes: ['D08'],
    signatures: [
      ['d4', 'd5', 'c4', 'e5', 'dxe5', 'd4', 'e3', 'Bb4+', 'Bd2', 'dxe3'],
      ['d4', 'd5', 'c4', 'e5', 'dxe5', 'd4'],
    ],
    description:
      'In the Albin Counter-Gambit, Black underpromotes to a knight (...exd2 then ...d1=N!) winning material — one of the rare practical underpromotion traps.',
  },
  {
    id: 'tennison-gambit',
    name: 'Tennison Gambit',
    setterSide: 'white',
    ecoCodes: ['A06'],
    signatures: [
      ['Nf3', 'd5', 'e4', 'dxe4', 'Ng5'],
    ],
    description:
      'White sacrifices a pawn after 1.Nf3 d5 2.e4 — leading to a quick attack on f7 and several well-known traps via Ng5.',
  },
  {
    id: 'budapest-gambit',
    name: 'Budapest Gambit',
    setterSide: 'black',
    ecoCodes: ['A51', 'A52'],
    signatures: [
      ['d4', 'Nf6', 'c4', 'e5'],
    ],
    description:
      'Black sacrifices the e-pawn for active piece play and the famous ...Ng4 trap line (Kieninger Trap if White is careless with Nf3 and Bf4).',
  },
  {
    id: 'mortimer-trap',
    name: 'Mortimer Trap',
    setterSide: 'black',
    ecoCodes: ['C65'],
    signatures: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'Nc3', 'Nd4'],
    ],
    description:
      "Black plays 4...Nd4 in the Berlin Ruy Lopez, baiting Nxe5 which loses to ...Qe7 winning a piece. Classic Ruy Lopez sucker punch.",
  },
  {
    id: 'sicilian-wing-gambit',
    name: 'Sicilian Wing Gambit',
    setterSide: 'white',
    ecoCodes: ['B20'],
    signatures: [
      ['e4', 'c5', 'b4'],
    ],
    description:
      'White sacrifices the b-pawn to deflect ...cxb4 and play d4 with a strong centre. Aggressive anti-Sicilian.',
  },
  {
    id: 'cochrane-gambit',
    name: 'Cochrane Gambit',
    setterSide: 'white',
    ecoCodes: ['C42'],
    signatures: [
      ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nxf7'],
    ],
    description:
      "White sacrifices the knight on f7 in the Petrov, exposing Black's king for a long-term attack and three pawns of compensation.",
  },
  {
    id: 'smith-morra',
    name: 'Smith-Morra Gambit',
    setterSide: 'white',
    ecoCodes: ['B21'],
    signatures: [
      ['e4', 'c5', 'd4', 'cxd4', 'c3'],
    ],
    description:
      'White sacrifices a pawn with c3 against the Sicilian for rapid development and open lines toward the king.',
  },
  {
    id: 'latvian-gambit',
    name: 'Latvian Gambit',
    setterSide: 'black',
    ecoCodes: ['C40'],
    signatures: [
      ['e4', 'e5', 'Nf3', 'f5'],
    ],
    description:
      'Aggressive King\'s Gambit reversed. Black plays ...f5 immediately for kingside attack — theoretically dubious, practically dangerous.',
  },
];

/** Map of trapId → TrapDefinition for fast lookup. */
export const OPENING_TRAPS_BY_ID: Map<string, TrapDefinition> = new Map(
  OPENING_TRAPS.map((t) => [t.id, t]),
);
