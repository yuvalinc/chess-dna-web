import { useState, useMemo } from 'react';
import type { SkillProfile } from '@shared/types/patterns';

export interface SamplePlayerData {
  username: string;
  rating: number;
  status: 'idle' | 'computing' | 'importing' | 'analyzing' | 'ready' | 'error';
  error?: string;
  gameCount?: number;
  profile?: SkillProfile;
  /** true if this player's games are already in the system */
  existingUser?: boolean;
}

interface KnownPlayer {
  username: string;
  rating: number;
  gameCount: number;
}

interface SamplePlayersSectionProps {
  players: SamplePlayerData[];
  knownPlayers: KnownPlayer[];
  onAddPlayer: (username: string) => void;
  onRemovePlayer: (username: string) => void;
  compact?: boolean;
}

export default function SamplePlayersSection({
  players,
  knownPlayers,
  onAddPlayer,
  onRemovePlayer,
  compact: _compact,
}: SamplePlayersSectionProps) {
  const [newUsername, setNewUsername] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const addedUsernames = useMemo(
    () => new Set(players.map((p) => p.username.toLowerCase())),
    [players],
  );

  const filteredSuggestions = useMemo(() => {
    const q = newUsername.trim().toLowerCase();
    return knownPlayers
      .filter((p) => !addedUsernames.has(p.username.toLowerCase()))
      .filter((p) => !q || p.username.toLowerCase().includes(q))
      .slice(0, 8);
  }, [knownPlayers, newUsername, addedUsernames]);

  const handleAdd = (username?: string) => {
    const name = (username ?? newUsername).trim();
    if (!name) return;
    if (addedUsernames.has(name.toLowerCase())) return;
    onAddPlayer(name);
    setNewUsername('');
    setShowSuggestions(false);
  };

  return (
    <div>
      {/* Input + suggestions */}
      <div className="relative">
        <div className="flex gap-1.5">
          <input
            type="text"
            placeholder="chess.com username"
            value={newUsername}
            onChange={(e) => { setNewUsername(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="flex-1 bg-chess-overlay text-chess-text text-[10px] rounded px-2 py-1.5 border border-chess-border/30"
          />
          <button
            onClick={() => handleAdd()}
            disabled={!newUsername.trim()}
            className="bg-chess-accent text-black text-[9px] font-semibold px-2.5 py-1.5 rounded hover:bg-chess-accent/80 disabled:opacity-40 transition-colors"
          >
            Add
          </button>
        </div>

        {/* Suggestion dropdown — known players */}
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-chess-surface border border-chess-border/30 rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
            <div className="px-2 py-1 text-[8px] text-chess-text-disabled uppercase tracking-wider border-b border-chess-border/20">
              Players with analyzed games ({knownPlayers.length} total)
            </div>
            {filteredSuggestions.map((p) => (
              <button
                key={p.username}
                onClick={() => handleAdd(p.username)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-chess-overlay/50 transition-colors"
              >
                <span className="text-[10px] text-chess-text flex-1">@{p.username}</span>
                <span className="text-[9px] text-chess-text-secondary">{p.rating}</span>
                <span className="text-[8px] text-chess-text-disabled">{p.gameCount}g</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Player chips */}
      {players.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {players.map((p) => (
            <div
              key={p.username}
              className="flex items-center gap-1.5 bg-chess-overlay/60 rounded-full px-2.5 py-1 group"
            >
              <span className="text-[10px] text-chess-text">@{p.username}</span>
              {p.rating > 0 && (
                <span className="text-[9px] text-chess-text-secondary">{p.rating}</span>
              )}

              {p.status === 'computing' && (
                <span className="text-[8px] text-chess-accent animate-pulse">...</span>
              )}
              {p.status === 'importing' && (
                <span className="text-[8px] text-amber-400 animate-pulse">importing</span>
              )}
              {p.status === 'analyzing' && (
                <span className="text-[8px] text-blue-400 animate-pulse">analyzing</span>
              )}
              {p.status === 'error' && (
                <span className="text-[8px] text-red-400" title={p.error}>!</span>
              )}
              {p.status === 'ready' && p.profile && (
                <span className="text-[10px] font-bold text-chess-accent">{p.profile.overallRating}</span>
              )}
              {p.gameCount != null && p.gameCount > 0 && (
                <span className="text-[8px] text-chess-text-disabled">{p.gameCount}g</span>
              )}

              <button
                onClick={() => onRemovePlayer(p.username)}
                className="text-[9px] text-chess-text-disabled hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
