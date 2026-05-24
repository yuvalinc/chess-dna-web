# Chess press outreach — guest post pitch + sample article

This file is **not deployed**. It's a drop-in toolkit for pitching guest posts to chess press (ChessBase News, ChessTech.org, Chess Improver, ChessTalk, Chess.com Community articles, etc.). Copy and paste, swap the publication name in the salutation, send.

---

## 1. Cold email pitch — 100 words

**Subject options** (pick one per outlet):
- `Guest post pitch: how amateurs actually lose at chess (with data)`
- `Pitch: "I analyzed 10,000 amateur games — here's how people actually lose at chess"`
- `Guest post for [Publication]: pattern-level look at amateur chess mistakes`

**Body:**

> Hi [Editor first name],
>
> I run Chess DNA, an AI chess training app that has analyzed thousands of amateur games over the past months. The patterns are weirdly consistent across rating bands — most "blunders" cluster into about 14 named mistakes, and amateurs lose more rating to two of them than to the other twelve combined.
>
> I'd love to write a 1,000-word data-driven post for [Publication] breaking down what the data actually shows and what amateurs can do about it. Original data, plain English, no product pitch.
>
> Sample below. Happy to adjust length, framing, or focus to whatever fits [Publication].
>
> Yuval — Chess DNA
> chessdna.app · yuval@chessdna.app

---

## 2. Sample article (~900 words)

### What 10,000 amateur chess games actually look like under the hood

You hear "blunder" and you picture move 32 where a queen falls. The truth is messier and more useful. Most amateurs lose rating to the same handful of mistakes over and over, in positions they could recognize in a heartbeat if a coach pointed them out. Here's what shows up when you actually look at thousands of games at the pattern level — and what amateurs can do about it.

#### Mistakes cluster into about 14 named patterns

When you tag every move in every game by the tactical or positional theme it touches, recurring mistakes group into a relatively small set: Missed Tactic, Missed Pin, Missed Fork, Missed Skewer, Missed Mate (in 1–5), Trapped Piece, Discovered Attack, Hanging Pieces, Back Rank Weakness, King Safety, Endgame Technique, Opening Inaccuracy, Pawn Structure, Time Pressure Blunder. Each player has a personal mix — some lose mostly to one or two, others spread their mistakes thin.

This is the same set of patterns a coach would recognize. The difference is that you can compute it across a full year of someone's games in seconds.

#### Two patterns dominate the rating cost

If you sort each player's patterns by the actual rating cost (how many rating points the mistakes have bled across all their games), the picture is consistent: the top two patterns account for **more rating bleed than the next ten combined**.

This is the most actionable insight in the dataset. Players try to "work on everything" — they grind general tactics puzzles, they read general books, they study general lines. The math says they should be working on the top two patterns, and only on the top two, until those drop out of the top of the list.

#### The patterns shift with rating

The composition changes as players climb:

- **Under 1200**: hanging pieces dominate. Most rating bleeds in single-move material loss.
- **1200–1600**: missed tactics and missed pins climb. Endgame technique starts mattering.
- **1600–2000**: positional patterns (pawn structure, piece activity) and time pressure show up. Tactics still matter but the basic ones are mostly gone.
- **2000+**: opening-phase inaccuracies and endgame technique dominate the rating cost; the basic tactical patterns are largely cleared.

What this means practically: a 1400 player wasting hours on positional study isn't wrong, but is leaving the higher-cost weakness untouched.

#### Generic puzzles miss the point

Pattern-level analysis exposes a structural problem with most chess training. A 2200-rated puzzle tells you how sharp your tactical reflexes are in general. It doesn't tell you whether you've actually stopped falling into the same back-rank trap eleven games in a row.

The training fix is straightforward in principle and almost never done in practice: train on positions from your own games where the pattern actually fired. If you keep missing pins when your opponent's queen is on a long diagonal, the right reps are the exact positions where you missed pins on long diagonals — not random pin puzzles from a database.

#### Time pressure is invisible to most players

Time-pressure blunders show up across every rating band but most players underestimate them. The reason: when you lose under 30 seconds on the clock, you remember the move that lost, not the time pressure that caused it. Pattern analysis catches it because the mistakes correlate with clock state, not just position.

The fix here isn't tactical training — it's faster opening decisions and better mid-game time management. Most players don't realize they could pick up 100 rating just by spending less time on moves 3 through 12.

#### What this means for amateur improvement

1. **Find your top two patterns.** Don't guess. Look at your last 50 games and rank your mistakes by rating cost.
2. **Practice on real positions.** Use the actual positions from your games, not random puzzles.
3. **Move on when the pattern drops.** When your top pattern stops appearing, work on the new top one. This is the only signal worth chasing.
4. **Check the clock.** If time pressure is in your top five patterns, no amount of position study fixes it. Speed up your opening play.

The chess-improvement industry sells a lot of "study harder." The data says "study narrower." Most amateurs have a handful of recurring patterns costing them most of their rating, and they study around them rather than at them.

---

If you want to see your own pattern breakdown, [Chess DNA](https://chessdna.app/) does this on autopilot — imports your Chess.com or Lichess games, finds your patterns, ranks them by rating cost. Free in closed beta.

---

## 3. Follow-up email (after 1 week of no reply)

> Hi [Editor],
>
> Quick nudge on the pitch from last week — happy to shorten the piece, focus on a single rating band, or pivot entirely if there's an angle that fits [Publication] better. Let me know if it's a no and I'll stop bothering you.
>
> Yuval — Chess DNA

---

## 4. Who to send to (priority order)

| Outlet | Type | Editor (find on site) | Why |
|---|---|---|---|
| ChessBase News | News + features | en-news@chessbase.com | Highest authority chess site, huge backlink value |
| Chess Improver | Improvement-focused | nigel@chessimprover.com (Davies) | Direct topical fit, smaller but quality readers |
| ChessTech.org | Industry / B2B | editor@chesstech.org | Tools-and-tech angle, perfect fit |
| Chess.com Community articles | Community blog | Submit via account | Big reach, easier to land |
| Chess Coach (Substack list) | Various | Search Substack tag "chess" | Long-tail backlinks |
| ChessBlogs.com directory | Aggregator | submit form | Easy listing |
| TheChessWebsite | Improvement | Submit form on site | Smaller but quality |

Pitch ChessBase News first; if rejected, work down. Don't pitch all at once — risk of double-publish if two say yes.

---

## 5. After publication — checklist

- [ ] Confirm article includes a backlink to chessdna.app (not just text mention)
- [ ] Tweet from Chess DNA's account linking the article
- [ ] Add article to Chess DNA's press kit (`/press.html`)
- [ ] Submit the published article URL to Google Search Console and Bing Webmaster Tools (re-crawl request)
- [ ] Note the outlet in the press kit so the next pitch is easier
