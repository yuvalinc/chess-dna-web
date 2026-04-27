import { useState, useEffect } from 'react';
import { useTheme } from '@/components/ThemeContext';
import { base44 } from '@/api/base44Client';

const { Feedback: FeedbackEntity } = base44.entities;

interface FeedbackItem {
  id: string;
  name?: string;
  email?: string;
  mobile?: string;
  category?: string;
  message: string;
  rating?: number;
  page?: string;
  userAgent?: string;
  submittedAt?: number;
  created_date?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  bug: 'bg-red-500/15 text-red-400 border-red-500/30',
  feature: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  other: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <svg key={s} width="14" height="14" viewBox="0 0 24 24"
          fill={s <= rating ? '#4ade80' : 'none'}
          stroke={s <= rating ? '#4ade80' : '#4b5563'}
          strokeWidth="1.5"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </div>
  );
}

export default function FeedbackAdmin() {
  const { isAdmin } = useTheme();
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    if (isAdmin !== true) return;
    (async () => {
      try {
        const list = await FeedbackEntity.list();
        setFeedbacks(
          (list as FeedbackItem[]).sort(
            (a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0)
          )
        );
      } catch (err) {
        console.error('Failed to load feedback:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  if (isAdmin === null) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold mb-2">Access Denied</h2>
        <p className="text-gray-500">This page is restricted to administrators.</p>
      </div>
    );
  }

  const filtered = filter === 'all' ? feedbacks : feedbacks.filter(f => f.category === filter);
  const avgRating = feedbacks.filter(f => f.rating).length > 0
    ? (feedbacks.reduce((s, f) => s + (f.rating ?? 0), 0) / feedbacks.filter(f => f.rating).length).toFixed(1)
    : null;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Feedback</h1>
      <p className="text-gray-500 text-sm mb-4">
        {feedbacks.length} submissions
        {avgRating && <span className="ml-2">· Avg rating: {avgRating}/5</span>}
      </p>

      {/* Filters */}
      <div className="flex gap-1.5 mb-4">
        {['all', 'bug', 'feature', 'other'].map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
              filter === cat
                ? 'bg-chess-accent/15 text-chess-accent border-chess-accent/30'
                : 'bg-chess-surface text-gray-500 border-chess-border/20 hover:border-chess-border/40'
            }`}
          >
            {cat === 'all' ? `All (${feedbacks.length})` : `${cat.charAt(0).toUpperCase() + cat.slice(1)} (${feedbacks.filter(f => f.category === cat).length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading feedback...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No feedback yet.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(fb => (
            <div key={fb.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              {/* Header: name + category + rating */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {fb.name && <span className="text-sm font-semibold text-chess-text">{fb.name}</span>}
                  {fb.category && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${CATEGORY_COLORS[fb.category] ?? CATEGORY_COLORS.other}`}>
                      {fb.category}
                    </span>
                  )}
                  {fb.rating && fb.rating > 0 && <StarDisplay rating={fb.rating} />}
                </div>
                <span className="text-[10px] text-gray-600 shrink-0">
                  {fb.submittedAt ? new Date(fb.submittedAt).toLocaleString() : fb.created_date ?? ''}
                </span>
              </div>

              {/* Message */}
              <p className="text-sm text-gray-300 whitespace-pre-wrap mb-2">{fb.message}</p>

              {/* Contact info + meta */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                {fb.email && <span>&#9993; {fb.email}</span>}
                {fb.mobile && <span>&#9742; {fb.mobile}</span>}
                {fb.page && <span>Page: {fb.page}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
