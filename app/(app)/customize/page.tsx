"use client";

import { useEffect, useState } from "react";
import {
  getTemplates,
  saveTemplate,
  deleteTemplate,
  type CustomTaskTemplate,
} from "@/hooks/use-journal-db";
import { Button } from "@/components/ui/button";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function blankTemplate(): CustomTaskTemplate {
  return {
    id: crypto.randomUUID(),
    name: "",
    what: "",
    skipDays: [],
    updatedAt: Date.now(),
  };
}

export default function CustomizePage() {
  const [templates, setTemplates] = useState<CustomTaskTemplate[]>([]);
  const [editing, setEditing] = useState<CustomTaskTemplate | null>(null);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    getTemplates().then(setTemplates);
  }, []);

  const openNew = () => {
    setEditing(blankTemplate());
    setIsNew(true);
  };

  const openEdit = (t: CustomTaskTemplate) => {
    setEditing({ ...t });
    setIsNew(false);
  };

  const handleSave = async () => {
    if (!editing || !editing.name.trim()) return;
    const updated = { ...editing, updatedAt: Date.now() };
    await saveTemplate(updated);
    const fresh = await getTemplates();
    setTemplates(fresh);
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    await deleteTemplate(id);
    setTemplates(t => t.filter(x => x.id !== id));
  };

  const toggleSkipDay = (day: number) => {
    if (!editing) return;
    const days = editing.skipDays.includes(day)
      ? editing.skipDays.filter(d => d !== day)
      : [...editing.skipDays, day];
    setEditing({ ...editing, skipDays: days });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-widest mb-0.5">Settings</p>
          <h1 className="text-2xl font-bold text-zinc-100">Custom Tasks</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Define recurring tasks that appear automatically every day they're active.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-indigo-600 hover:bg-indigo-500 text-white"
          onClick={openNew}
        >
          + New task
        </Button>
      </div>

      {/* Editor */}
      {editing && (
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-200">
            {isNew ? "New custom task" : "Edit custom task"}
          </h2>

          <div className="space-y-1">
            <label className="text-xs text-zinc-500 uppercase tracking-wider">Name</label>
            <input
              autoFocus
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. Morning workout"
              className="w-full bg-transparent border-b border-zinc-700 pb-1 text-sm text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-500 uppercase tracking-wider">What to do</label>
            <textarea
              value={editing.what}
              onChange={e => setEditing({ ...editing, what: e.target.value })}
              placeholder="Describe what this task involves…"
              rows={2}
              className="w-full bg-zinc-900/60 border border-zinc-700/60 rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-indigo-500 resize-none transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-zinc-500 uppercase tracking-wider">Skip on days</label>
            <div className="flex gap-2 flex-wrap">
              {DAY_NAMES.map((name, i) => {
                const active = editing.skipDays.includes(i);
                return (
                  <button
                    key={i}
                    onClick={() => toggleSkipDay(i)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      active
                        ? "bg-red-500/20 text-red-400 border border-red-500/40"
                        : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-500"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-600">
              {editing.skipDays.length === 0
                ? "Task appears every day"
                : `Skipped on: ${editing.skipDays.map(d => DAY_NAMES[d]).join(", ")}`}
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
              onClick={handleSave}
              disabled={!editing.name.trim()}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-zinc-500 hover:text-zinc-200"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Template list */}
      {templates.length === 0 && !editing ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-6 py-10 text-center">
          <p className="text-zinc-500 text-sm">No custom tasks yet.</p>
          <p className="text-zinc-600 text-xs mt-1">Click "+ New task" to create your first one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map(t => {
            const activeDays = DAY_NAMES.filter((_, i) => !t.skipDays.includes(i));
            return (
              <div
                key={t.id}
                className="flex items-start justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 group"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-200">{t.name}</p>
                  {t.what && (
                    <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{t.what}</p>
                  )}
                  <p className="text-[11px] text-zinc-600 mt-1">
                    Active on: {activeDays.length === 7 ? "every day" : activeDays.join(", ")}
                  </p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEdit(t)}
                    className="text-xs text-zinc-500 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="text-xs text-zinc-600 hover:text-red-400 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
