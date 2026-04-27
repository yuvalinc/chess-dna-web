import { useState, useEffect, useCallback } from 'react';
import { useEntityCRUD } from '@/hooks/useEntity';
import { getAllConfigs, invalidateConfigCache } from '@/patterns/skill-config-loader';
import type { SkillCalcConfigSchema, SkillCalcConfigEntity } from '@shared/types/skill-config';

interface VersionPanelProps {
  currentConfig: SkillCalcConfigSchema;
  onLoadVersion: (config: SkillCalcConfigSchema) => void;
  onPublished: () => void;
  authorEmail: string;
}

export default function VersionPanel({ currentConfig, onLoadVersion, onPublished, authorEmail }: VersionPanelProps) {
  const [versions, setVersions] = useState<SkillCalcConfigEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const { create, update } = useEntityCRUD('SkillCalcConfig');

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    const configs = await getAllConfigs();
    setVersions(configs.sort((a, b) => (b.version ?? 0) - (a.version ?? 0)));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const handleSaveDraft = useCallback(async () => {
    const nextVersion = versions.length > 0 ? Math.max(...versions.map((v) => v.version ?? 0)) + 1 : 1;
    try {
      await create({
        version: nextVersion,
        status: 'draft',
        authorEmail,
        label: `Draft v${nextVersion}`,
        config: JSON.stringify(currentConfig),
        createdAt: Date.now(),
        publishedAt: null,
      });
      fetchVersions();
    } catch (err) {
      console.error('Failed to save draft:', err);
    }
  }, [currentConfig, versions, authorEmail, create, fetchVersions]);

  const handlePublish = useCallback(async (versionId: string) => {
    try {
      // Archive all currently published versions
      const published = versions.filter((v) => v.status === 'published');
      for (const p of published) {
        await update(p.id, { status: 'archived' });
      }

      // Publish the selected version
      await update(versionId, { status: 'published', publishedAt: Date.now() });
      invalidateConfigCache();
      fetchVersions();
      onPublished();
    } catch (err) {
      console.error('Failed to publish:', err);
    }
  }, [versions, update, fetchVersions, onPublished]);

  const handleArchive = useCallback(async (versionId: string) => {
    try {
      await update(versionId, { status: 'archived' });
      fetchVersions();
    } catch (err) {
      console.error('Failed to archive:', err);
    }
  }, [update, fetchVersions]);

  const statusColor = (status: string) => {
    switch (status) {
      case 'published': return 'text-green-400';
      case 'draft': return 'text-amber-400';
      default: return 'text-chess-text-disabled';
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-chess-text">Versions</h4>
        <button
          onClick={handleSaveDraft}
          className="text-[10px] bg-chess-accent text-black font-semibold px-2 py-1 rounded hover:bg-chess-accent/80 transition-colors"
        >
          Save as Draft
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-chess-text-secondary text-center py-4">Loading...</div>
      ) : versions.length === 0 ? (
        <p className="text-xs text-chess-text-disabled text-center py-4">
          No saved versions yet. Edit the config and save as draft to start versioning.
        </p>
      ) : (
        <div className="space-y-1 max-h-[300px] overflow-y-auto">
          {versions.map((v) => (
            <div key={v.id} className="bg-chess-overlay rounded-lg px-2.5 py-2 flex items-center gap-2">
              <div className="flex-1">
                <div className="text-xs text-chess-text font-semibold">{v.label || `v${v.version}`}</div>
                <div className="text-[9px] text-chess-text-disabled">
                  <span className={statusColor(v.status)}>{v.status}</span>
                  {' · '}
                  {v.authorEmail?.split('@')[0]}
                  {' · '}
                  {new Date(v.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    const config = typeof v.config === 'string' ? JSON.parse(v.config) : v.config;
                    onLoadVersion(config);
                  }}
                  className="text-[9px] text-chess-accent hover:underline"
                >
                  Load
                </button>
                {v.status === 'draft' && (
                  <button
                    onClick={() => handlePublish(v.id)}
                    className="text-[9px] text-green-400 hover:underline"
                  >
                    Publish
                  </button>
                )}
                {v.status !== 'archived' && (
                  <button
                    onClick={() => handleArchive(v.id)}
                    className="text-[9px] text-chess-text-disabled hover:text-red-400"
                  >
                    Archive
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
