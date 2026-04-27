import { useState, useCallback } from 'react';
import { useEntityList, useEntityCRUD } from '@/hooks/useEntity';
import { WeaknessTheme } from '@shared/types/patterns';
import type { SkillDimensionId } from '@shared/types/patterns';
import type { AffiliateApp } from '@shared/types/affiliate';

const ALL_DIMENSIONS: { id: SkillDimensionId; label: string }[] = [
  { id: 'openings', label: 'Openings' },
  { id: 'tactics', label: 'Tactics' },
  { id: 'defense', label: 'Defense' },
  { id: 'positional', label: 'Positional' },
  { id: 'endgame', label: 'Endgame' },
  { id: 'calculation', label: 'Calculation' },
  { id: 'time_management', label: 'Time Management' },
  { id: 'resilience', label: 'Resilience' },
];

const ALL_THEMES = Object.values(WeaknessTheme);

export default function AffiliateAdmin() {

  return <AffiliateAdminContent />;
}

function AffiliateAdminContent() {
  const [apps, loading, , refetch] = useEntityList<AffiliateApp>('AffiliateApp');
  const { create, update, remove } = useEntityCRUD('AffiliateApp');
  const [editing, setEditing] = useState<Partial<AffiliateApp> | null>(null);
  const [saving, setSaving] = useState(false);

  const handleNew = () => {
    setEditing({
      name: '',
      logoUrl: '',
      description: '',
      url: '',
      dimensions: [],
      themes: [],
      tags: [],
      priority: apps.length,
      active: true,
    });
  };

  const handleSave = useCallback(async () => {
    if (!editing?.name?.trim()) return;
    setSaving(true);
    try {
      if (editing.id) {
        const { id, ...data } = editing;
        await update(id, { ...data, updatedAt: Date.now() });
      } else {
        await create({ ...editing, createdAt: Date.now(), updatedAt: Date.now() });
      }
      setEditing(null);
      refetch();
    } catch (err) {
      console.error('Failed to save affiliate app:', err);
    } finally {
      setSaving(false);
    }
  }, [editing, create, update, refetch]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await remove(id);
      refetch();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  }, [remove, refetch]);

  const toggleDimension = (dim: SkillDimensionId) => {
    if (!editing) return;
    const dims = editing.dimensions ?? [];
    setEditing({
      ...editing,
      dimensions: dims.includes(dim) ? dims.filter((d) => d !== dim) : [...dims, dim],
    });
  };

  const toggleTheme = (theme: WeaknessTheme) => {
    if (!editing) return;
    const themes = editing.themes ?? [];
    setEditing({
      ...editing,
      themes: themes.includes(theme) ? themes.filter((t) => t !== theme) : [...themes, theme],
    });
  };

  return (
    <div className="max-w-2xl mx-auto py-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-chess-text">Affiliate Apps</h1>
        <button
          onClick={handleNew}
          className="bg-chess-accent text-black text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-chess-accent/80 transition-colors"
        >
          + Add App
        </button>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="bg-chess-surface rounded-xl border border-chess-border/30 p-4 mb-6 space-y-3">
          <h2 className="text-sm font-semibold text-chess-text">
            {editing.id ? 'Edit App' : 'New App'}
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] font-semibold text-chess-text-secondary uppercase">Name</label>
              <input
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="w-full mt-1 bg-chess-overlay text-chess-text text-xs rounded px-2 py-1.5 border border-chess-border/30"
              />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-semibold text-chess-text-secondary uppercase">Description</label>
              <textarea
                value={editing.description ?? ''}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                rows={2}
                className="w-full mt-1 bg-chess-overlay text-chess-text text-xs rounded px-2 py-1.5 border border-chess-border/30"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-chess-text-secondary uppercase">URL</label>
              <input
                value={editing.url ?? ''}
                onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                className="w-full mt-1 bg-chess-overlay text-chess-text text-xs rounded px-2 py-1.5 border border-chess-border/30"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-chess-text-secondary uppercase">Logo URL</label>
              <input
                value={editing.logoUrl ?? ''}
                onChange={(e) => setEditing({ ...editing, logoUrl: e.target.value })}
                className="w-full mt-1 bg-chess-overlay text-chess-text text-xs rounded px-2 py-1.5 border border-chess-border/30"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-chess-text-secondary uppercase">Priority (lower = higher)</label>
              <input
                type="number"
                value={editing.priority ?? 0}
                onChange={(e) => setEditing({ ...editing, priority: parseInt(e.target.value) || 0 })}
                className="w-full mt-1 bg-chess-overlay text-chess-text text-xs rounded px-2 py-1.5 border border-chess-border/30"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-semibold text-chess-text-secondary uppercase">Active</label>
              <input
                type="checkbox"
                checked={editing.active ?? true}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                className="accent-chess-accent"
              />
            </div>
          </div>

          {/* Dimensions */}
          <div>
            <label className="text-[10px] font-semibold text-chess-text-secondary uppercase">Skill Dimensions</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {ALL_DIMENSIONS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => toggleDimension(d.id)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    (editing.dimensions ?? []).includes(d.id)
                      ? 'border-chess-accent bg-chess-accent/15 text-chess-accent'
                      : 'border-chess-border/30 text-chess-text-disabled hover:text-chess-text-secondary'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Themes */}
          <div>
            <label className="text-[10px] font-semibold text-chess-text-secondary uppercase">Weakness Themes</label>
            <div className="flex flex-wrap gap-1 mt-1 max-h-24 overflow-y-auto">
              {ALL_THEMES.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleTheme(t)}
                  className={`text-[9px] px-1.5 py-0.5 rounded-full border transition-colors ${
                    (editing.themes ?? []).includes(t)
                      ? 'border-chess-accent bg-chess-accent/15 text-chess-accent'
                      : 'border-chess-border/30 text-chess-text-disabled hover:text-chess-text-secondary'
                  }`}
                >
                  {t.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="text-[10px] font-semibold text-chess-text-secondary uppercase">Tags (comma separated)</label>
            <input
              value={(editing.tags ?? []).join(', ')}
              onChange={(e) => setEditing({ ...editing, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              className="w-full mt-1 bg-chess-overlay text-chess-text text-xs rounded px-2 py-1.5 border border-chess-border/30"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-chess-accent text-black text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-chess-accent/80 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="text-xs text-chess-text-secondary hover:text-chess-text px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* App list */}
      {loading ? (
        <div className="text-center py-8 text-chess-text-secondary text-sm">Loading...</div>
      ) : apps.length === 0 && !editing ? (
        <div className="text-center py-8">
          <p className="text-chess-text-secondary text-sm mb-2">No affiliate apps yet.</p>
          <p className="text-chess-text-disabled text-xs">Add apps that help users improve specific chess skills.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {apps
            .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
            .map((app) => (
              <div
                key={app.id}
                className={`bg-chess-surface rounded-lg border p-3 flex items-start gap-3 ${
                  app.active ? 'border-chess-border/30' : 'border-chess-border/10 opacity-50'
                }`}
              >
                {app.logoUrl && (
                  <img src={app.logoUrl} alt="" className="w-8 h-8 rounded object-cover" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-chess-text">{app.name}</span>
                    {!app.active && (
                      <span className="text-[9px] text-chess-text-disabled">(inactive)</span>
                    )}
                  </div>
                  <p className="text-[10px] text-chess-text-secondary mt-0.5 line-clamp-2">{app.description}</p>
                  {(app.dimensions?.length > 0 || app.themes?.length > 0) && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {app.dimensions?.map((d) => (
                        <span key={d} className="text-[8px] bg-chess-accent/10 text-chess-accent px-1.5 py-0.5 rounded-full">{d}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setEditing(app)}
                    className="text-[10px] text-chess-accent hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(app.id)}
                    className="text-[10px] text-red-400/60 hover:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
