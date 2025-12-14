import { useEffect, useState } from 'react';
import { Cog, Save, AlertCircle, CheckCircle2 } from 'lucide-react';
import { getSettings, updateSettings, type LocalSettings } from '../lib/api';

export default function SettingsView() {
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await getSettings();
        setSettings(s);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load settings');
      }
    })();
  }, []);

  const onSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await updateSettings(settings);
      setSettings(next);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent mb-4">
          Settings
        </h1>
        <p className="text-zinc-500 max-w-xl mx-auto">
          Configure local runtime settings (stored in a gitignored file on the server).
        </p>
      </div>

      <div className="glass-panel rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Cog size={18} />
            </div>
            <h2 className="text-lg font-semibold text-white">LLM Judge (Ollama)</h2>
          </div>

          <button
            onClick={onSave}
            disabled={!dirty || saving || !settings}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-semibold border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Save size={16} />
            Save
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-sm text-red-400">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {saved && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-start gap-2 text-sm text-emerald-400">
            <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
            <p>Saved.</p>
          </div>
        )}

        {!settings ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Ollama Host</span>
                <input
                  value={settings.ollama.host}
                  onChange={(e) => { setDirty(true); setSettings(s => s ? ({ ...s, ollama: { ...s.ollama, host: e.target.value } }) : s); }}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200"
                  placeholder="http://localhost"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Port</span>
                <input
                  type="number"
                  value={settings.ollama.port}
                  onChange={(e) => { setDirty(true); setSettings(s => s ? ({ ...s, ollama: { ...s.ollama, port: parseInt(e.target.value || '0', 10) } }) : s); }}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200"
                />
              </label>
            </div>

            <label className="space-y-2">
              <span className="text-sm text-zinc-300">Ollama Model</span>
              <input
                value={settings.ollama.model}
                onChange={(e) => { setDirty(true); setSettings(s => s ? ({ ...s, ollama: { ...s.ollama, model: e.target.value } }) : s); }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200 font-mono"
                placeholder="llama3.1:8b"
              />
              <p className="text-xs text-zinc-500">
                Must exist in <span className="font-mono">ollama list</span>. Example: <span className="font-mono">llama3.1:8b</span>
              </p>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Temperature</span>
                <input
                  type="number"
                  step="0.1"
                  value={settings.ollama.temperature}
                  onChange={(e) => { setDirty(true); setSettings(s => s ? ({ ...s, ollama: { ...s.ollama, temperature: parseFloat(e.target.value || '0') } }) : s); }}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm text-zinc-300">Max Tokens</span>
                <input
                  type="number"
                  value={settings.ollama.maxTokens}
                  onChange={(e) => { setDirty(true); setSettings(s => s ? ({ ...s, ollama: { ...s.ollama, maxTokens: parseInt(e.target.value || '0', 10) } }) : s); }}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-200"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}



