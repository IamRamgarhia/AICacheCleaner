import React, { useState, useEffect } from 'react';
import { Download, Upload, RefreshCw, ArrowRight, FolderOpen, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { AISoftwareAppItem } from '../types';

interface MigrationWizardProps {
  detectedSoftware?: AISoftwareAppItem[];
}

/** An app the backend can read transcripts from / write transcripts for. */
/** A project with AI conversation history attached to it. */
interface ProjectLink {
  projectPath: string;
  name: string;
  exists: boolean;
  totalAiBytes: number;
  totalAiFormatted: string;
  sources: { tool: string; path: string; sizeBytes: number; formattedSize: string; entries?: number }[];
}

interface TranscriptAppInfo {
  id: string;
  label: string;
  detected: boolean;
  readable: boolean;
  transcriptCount: number;
  reason?: string;
  root: string;
}

const ASSETS: { id: string; label: string; hint: string }[] = [
  { id: 'sourceCode', label: 'Project source', hint: 'excludes node_modules and build output' },
  { id: 'chatTranscripts', label: 'Chat transcripts', hint: 'conversation history and agent reasoning' },
  { id: 'vectorEmbeddings', label: 'Vector indexes', hint: 'semantic search databases' },
  { id: 'mcpBindings', label: 'MCP server configs', hint: 'tool bindings and connectors' },
  { id: 'systemPrompts', label: 'Prompts & commands', hint: 'custom slash commands and prompt libraries' },
  { id: 'llmWeights', label: 'Model weights', hint: 'very large — can add tens of GB' }
];

export const MigrationWizard: React.FC<MigrationWizardProps> = ({ detectedSoftware: propSoftware }) => {
  const [installedSoftware, setInstalledSoftware] = useState<AISoftwareAppItem[]>([]);
  const [loadingSoftware, setLoadingSoftware] = useState<boolean>(true);
  const [selectedSwIds, setSelectedSwIds] = useState<{ [id: string]: boolean }>({});
  const [includedAssets, setIncludedAssets] = useState<{ [key: string]: boolean }>({
    sourceCode: true,
    chatTranscripts: true,
    vectorEmbeddings: true,
    mcpBindings: true,
    systemPrompts: true,
    llmWeights: false
  });

  const [projectFolderPath, setProjectFolderPath] = useState<string>('');
  const [customZipDestination, setCustomZipDestination] = useState<string>('');
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportResult, setExportResult] = useState<{ ok: boolean; text: string; zipPath?: string } | null>(null);

  const [importing, setImporting] = useState<boolean>(false);
  const [importZipPath, setImportZipPath] = useState<string>('');
  const [importExtractPath, setImportExtractPath] = useState<string>('');
  const [importResult, setImportResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [sourceApp, setSourceApp] = useState<string>('');
  const [targetApp, setTargetApp] = useState<string>('');
  const [convertMsg, setConvertMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [converting, setConverting] = useState<boolean>(false);
  const [transcriptApps, setTranscriptApps] = useState<TranscriptAppInfo[]>([]);
  const [transcriptAppsLoaded, setTranscriptAppsLoaded] = useState<boolean>(false);

  // --- Project-first export state ---
  const [projects, setProjects] = useState<ProjectLink[]>([]);
  const [unlinkable, setUnlinkable] = useState<{ tool: string; reason: string }[]>([]);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [includeCode, setIncludeCode] = useState<boolean>(true);
  const [exportingProject, setExportingProject] = useState<boolean>(false);
  const [projectResult, setProjectResult] = useState<{ ok: boolean; text: string; zipPath?: string } | null>(null);

  const activeProject = projects.find(p => p.projectPath === selectedProject) || null;

  const fetchProjects = async () => {
    setLoadingProjects(true);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
        setUnlinkable(data.unlinkable || []);
        if (!selectedProject && data.projects?.length) setSelectedProject(data.projects[0].projectPath);
      }
    } catch (e) {
      console.warn('Could not list projects:', (e as Error).message);
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleExportProject = async () => {
    setExportingProject(true);
    setProjectResult(null);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/export-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: selectedProject, includeCode })
      });
      const data = await res.json();
      if (data.success) {
        setProjectResult({
          ok: true,
          text: `Packaged ${data.totalFiles} file(s)${data.includedTools.length ? ` plus history from ${data.includedTools.join(', ')}` : ''} — ${data.formattedSize}.`,
          zipPath: data.zipPath
        });
      } else {
        setProjectResult({ ok: false, text: data.error || 'Export failed.' });
      }
    } catch (e) {
      setProjectResult({ ok: false, text: `Export failed: ${(e as Error).message}` });
    } finally {
      setExportingProject(false);
    }
  };

  const fetchInstalledSoftware = async () => {
    setLoadingSoftware(true);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/software');
      if (res.ok) {
        const data = await res.json();
        const list: AISoftwareAppItem[] = data.software || [];
        const installed = list.filter(s => s.status !== 'NOT INSTALLED' || s.totalDiskSizeBytes > 0);
        setInstalledSoftware(installed);
        const initial: { [id: string]: boolean } = {};
        installed.forEach(s => (initial[s.id] = true));
        setSelectedSwIds(initial);
      }
    } catch (e) {
      if (propSoftware?.length) setInstalledSoftware(propSoftware);
    } finally {
      setLoadingSoftware(false);
    }
  };

  const fetchTranscriptApps = async () => {
    try {
      const res = await fetch('http://127.0.0.1:3333/api/transcript-apps');
      if (res.ok) {
        const data = await res.json();
        const apps: TranscriptAppInfo[] = data.apps || [];
        setTranscriptApps(apps);
        const readable = apps.filter(a => a.readable);
        if (readable.length > 0) setSourceApp(readable[0].id);
        const other = apps.find(a => a.id !== readable[0]?.id);
        if (other) setTargetApp(other.id);
      }
    } catch (e) {
      console.warn('Could not load transcript apps:', (e as Error).message);
    } finally {
      setTranscriptAppsLoaded(true);
    }
  };

  useEffect(() => {
    fetchInstalledSoftware();
    fetchTranscriptApps();
    fetchProjects();
  }, []);

  const readableApps = transcriptApps.filter(a => a.readable);
  const detectedApps = transcriptApps.filter(a => a.detected);
  const targetOptions = transcriptApps.filter(a => a.id !== sourceApp);

  const handleExportVault = async () => {
    setExporting(true);
    setExportResult(null);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/export-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: projectFolderPath.trim() || undefined,
          outputZipPath: customZipDestination.trim() || undefined,
          selectedSoftwareIds: Object.keys(selectedSwIds).filter(id => selectedSwIds[id]),
          includedAssets
        })
      });
      const data = await res.json();
      if (data.success) {
        setExportResult({
          ok: true,
          text: `Packaged ${data.manifest?.totalFiles ?? 0} files.`,
          zipPath: data.zipPath
        });
      } else {
        setExportResult({ ok: false, text: data.error || 'Export failed.' });
      }
    } catch (e) {
      setExportResult({ ok: false, text: `Export failed: ${(e as Error).message}` });
    } finally {
      setExporting(false);
    }
  };

  const handleImportVault = async () => {
    if (!importZipPath.trim()) {
      setImportResult({ ok: false, text: 'Enter the path to a vault .zip first.' });
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/import-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaultZipPath: importZipPath.trim(),
          destinationFolder: importExtractPath.trim() || undefined
        })
      });
      const data = await res.json();
      setImportResult({ ok: !!data.success, text: data.message || data.error || 'Import finished.' });
    } catch (e) {
      setImportResult({ ok: false, text: `Import failed: ${(e as Error).message}` });
    } finally {
      setImporting(false);
    }
  };

  const handleConvertTranscripts = async () => {
    setConverting(true);
    setConvertMsg(null);
    try {
      const res = await fetch('http://127.0.0.1:3333/api/convert-transcripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceApp, targetApp })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Server returned ${res.status}`);
      setConvertMsg({ ok: data.converted > 0, text: data.message });
    } catch (e) {
      setConvertMsg({ ok: false, text: `Conversion failed: ${(e as Error).message}` });
    } finally {
      setConverting(false);
    }
  };

  const openFolder = async (folderPath?: string) => {
    if (!folderPath) return;
    try {
      await fetch('http://127.0.0.1:3333/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      });
    } catch (e) {
      console.warn('Could not open folder:', (e as Error).message);
    }
  };

  return (
    <div className="ins-page">
      <header className="ins-page-head">
        <div>
          <h1 className="ins-h1">Export &amp; migrate</h1>
          <p className="ins-sub">
            Package your AI tools&apos; memory, configs and project code into one archive to carry to
            another machine — or convert transcripts between tools.
          </p>
        </div>
        <button className="ins-btn" onClick={fetchInstalledSoftware} disabled={loadingSoftware}>
          <RefreshCw size={14} className={loadingSoftware ? 'spin' : ''} /> Rescan
        </button>
      </header>

      {/* Project-first export. Archiving whole tools means packaging every
          project you have ever touched (Antigravity alone is 22 GB here), which
          is the wrong unit for moving one piece of work to another machine. */}
      <div className="ins-panel" style={{ padding: 'var(--ins-space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--ins-space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--ins-space-3)', flexWrap: 'wrap' }}>
          <div>
            <span className="ins-label">Export one project</span>
            <p className="ins-sub" style={{ marginTop: '4px' }}>
              Pick a project and get its code plus every AI conversation about it — from any tool that
              records which project it was working on.
            </p>
          </div>
          <button className="ins-btn" onClick={fetchProjects} disabled={loadingProjects}>
            <RefreshCw size={14} className={loadingProjects ? 'spin' : ''} />
            {loadingProjects ? 'Finding' : 'Find projects'}
          </button>
        </div>

        <div className="ins-grid--pair">
          <div>
            <label className="ins-field-label" htmlFor="projpick">
              Projects with AI history ({projects.length})
            </label>
            <select
              id="projpick"
              className="ins-select"
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
              disabled={projects.length === 0}
            >
              {projects.length === 0 && <option value="">{loadingProjects ? 'Searching…' : 'None found yet'}</option>}
              {projects.map(p => (
                <option key={p.projectPath} value={p.projectPath}>
                  {p.name} — {p.totalAiFormatted}
                  {p.exists ? '' : ' (folder gone)'}
                </option>
              ))}
            </select>
            <span className="ins-meta" style={{ marginTop: '5px', display: 'block' }}>
              Or paste any folder path below to look it up directly.
            </span>
            <input
              className="ins-input"
              style={{ marginTop: '6px' }}
              type="text"
              placeholder="D:\projects\my-app"
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
            />
          </div>

          <div>
            <span className="ins-label">What will be included</span>
            <div className="ins-well" style={{ marginTop: '6px', minHeight: '86px' }}>
              {activeProject ? (
                <>
                  {activeProject.sources.map(s => (
                    <div key={s.path} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>
                        {s.tool}
                        {s.entries ? ` · ${s.entries} session(s)` : ''}
                      </span>
                      <span className="ins-data" style={{ color: 'var(--ins-mist-50)' }}>{s.formattedSize}</span>
                    </div>
                  ))}
                  {activeProject.sources.length === 0 && <div>No linked AI history found for this folder.</div>}
                </>
              ) : (
                <div>Select a project to see what would be packaged.</div>
              )}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: '0.8125rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeCode} onChange={e => setIncludeCode(e.target.checked)} />
              Include project source
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ins-space-3)', flexWrap: 'wrap' }}>
          <button
            className="ins-btn ins-btn--primary"
            disabled={!selectedProject || exportingProject}
            onClick={handleExportProject}
          >
            <Download size={14} /> {exportingProject ? 'Packaging…' : 'Export this project'}
          </button>
          {projectResult && (
            <div className={`ins-note ${projectResult.ok ? 'ins-note--ok' : 'ins-note--error'}`} style={{ flex: 1, minWidth: '280px' }}>
              {projectResult.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span style={{ minWidth: 0 }}>{projectResult.text}</span>
              {projectResult.zipPath && (
                <button className="ins-btn ins-btn--quiet" style={{ marginLeft: 'auto' }} onClick={() => openFolder(projectResult.zipPath)}>
                  <FolderOpen size={13} /> Show
                </button>
              )}
            </div>
          )}
        </div>

        {unlinkable.length > 0 && (
          <div className="ins-meta">
            Not included: {unlinkable.map(u => `${u.tool} (${u.reason})`).join('; ')}. Use the whole-tool
            archive below for those.
          </div>
        )}
      </div>

      <div className="ins-grid--pair">
        {/* What to include */}
        <div className="ins-card">
          <span className="ins-label">Tools to include ({installedSoftware.length})</span>
          {loadingSoftware ? (
            <div className="ins-meta">Scanning…</div>
          ) : installedSoftware.length === 0 ? (
            <div className="ins-meta">No AI tools detected. You can still export a project folder below.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minHeight: 0, maxHeight: '340px', overflowY: 'auto' }}>
              {installedSoftware.map(sw => (
                <label key={sw.id} className={`ins-choice${selectedSwIds[sw.id] ? ' ins-choice--on' : ''}`} style={{ alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={!!selectedSwIds[sw.id]}
                    onChange={() => setSelectedSwIds(prev => ({ ...prev, [sw.id]: !prev[sw.id] }))}
                  />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', color: 'var(--ins-mist-50)' }}>{sw.name}</span>
                    <span className="ins-meta">{sw.formattedDiskSize}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Asset categories */}
        <div className="ins-card">
          <span className="ins-label">Data to package</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {ASSETS.map(asset => (
              <label key={asset.id} className={`ins-choice${includedAssets[asset.id] ? ' ins-choice--on' : ''}`} style={{ alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={!!includedAssets[asset.id]}
                  onChange={() => setIncludedAssets(prev => ({ ...prev, [asset.id]: !prev[asset.id] }))}
                />
                <span>
                  <span style={{ display: 'block', color: 'var(--ins-mist-50)' }}>{asset.label}</span>
                  <span className="ins-meta">{asset.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Export */}
      <div className="ins-panel" style={{ padding: 'var(--ins-space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--ins-space-4)' }}>
        <span className="ins-label">Export archive</span>

        <div className="ins-grid--pair">
          <div>
            <label className="ins-field-label" htmlFor="projfolder">Project folder (optional)</label>
            <input id="projfolder" className="ins-input" type="text" placeholder="D:\projects\my-app" value={projectFolderPath} onChange={e => setProjectFolderPath(e.target.value)} />
          </div>
          <div>
            <label className="ins-field-label" htmlFor="zipdest">Save archive to (optional)</label>
            <input id="zipdest" className="ins-input" type="text" placeholder="Defaults to your Desktop" value={customZipDestination} onChange={e => setCustomZipDestination(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ins-space-3)', flexWrap: 'wrap' }}>
          <button className="ins-btn ins-btn--primary" disabled={exporting} onClick={handleExportVault}>
            <Download size={14} /> {exporting ? 'Packaging…' : 'Create archive'}
          </button>
          {exportResult && (
            <div className={`ins-note ${exportResult.ok ? 'ins-note--ok' : 'ins-note--error'}`} style={{ flex: 1, minWidth: '260px' }}>
              {exportResult.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{exportResult.text}</span>
              {exportResult.zipPath && (
                <button className="ins-btn ins-btn--quiet" onClick={() => openFolder(exportResult.zipPath)} style={{ marginLeft: 'auto' }}>
                  <FolderOpen size={13} /> Show
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="ins-grid--pair">
        {/* Import */}
        <div className="ins-card">
          <span className="ins-label">Restore an archive</span>
          <div>
            <label className="ins-field-label" htmlFor="zippath">Archive file</label>
            <input id="zippath" className="ins-input" type="text" placeholder="C:\Users\you\Desktop\AICacheCleaner_Vault_….zip" value={importZipPath} onChange={e => setImportZipPath(e.target.value)} />
          </div>
          <div>
            <label className="ins-field-label" htmlFor="extractpath">Unpack into (optional)</label>
            <input id="extractpath" className="ins-input" type="text" placeholder="Defaults to your Desktop" value={importExtractPath} onChange={e => setImportExtractPath(e.target.value)} />
          </div>
          <button className="ins-btn" disabled={importing} onClick={handleImportVault} style={{ justifyContent: 'center', marginTop: 'auto' }}>
            <Upload size={14} /> {importing ? 'Unpacking…' : 'Unpack archive'}
          </button>
          {importResult && (
            <div className={`ins-note ${importResult.ok ? 'ins-note--ok' : 'ins-note--error'}`}>{importResult.text}</div>
          )}
        </div>

        {/* Transcript conversion */}
        <div className="ins-card">
          <span className="ins-label">Convert transcripts</span>
          <p className="ins-meta" style={{ lineHeight: 1.5 }}>
            Reads the transcripts a tool stores on this PC and rewrites them in another tool&apos;s on-disk
            format, plus a readable Markdown copy. Only tools found here are listed.
          </p>

          {transcriptAppsLoaded && readableApps.length === 0 && (
            <div className="ins-note ins-note--warn">
              <AlertTriangle size={15} /> No readable transcripts found for any detected tool.
            </div>
          )}

          {transcriptAppsLoaded && detectedApps.some(a => !a.readable) && (
            <div className="ins-well" style={{ fontSize: '0.75rem' }}>
              <strong style={{ color: 'var(--ins-mist-300)', display: 'block', marginBottom: '4px' }}>
                Detected but not convertible yet
              </strong>
              {detectedApps
                .filter(a => !a.readable)
                .map(a => (
                  <div key={a.id}>
                    {a.label} — {a.reason}
                  </div>
                ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 'var(--ins-space-2)', alignItems: 'end' }}>
            <div>
              <label className="ins-field-label" htmlFor="srcapp">From</label>
              {/* Every DETECTED tool is listed, including ones we can't read
                  yet — with the reason on the option — so an installed tool is
                  never silently missing from this list. */}
              <select id="srcapp" className="ins-select" value={sourceApp} disabled={readableApps.length === 0} onChange={e => setSourceApp(e.target.value)}>
                {readableApps.length === 0 && <option value="">No readable transcripts</option>}
                {/* Labels stay short: a native select popup renders at the
                    width of its longest option and escapes the card, so the
                    full reason lives in the panel below instead. */}
                {detectedApps.map(a => (
                  <option key={a.id} value={a.id} disabled={!a.readable}>
                    {a.label}
                    {a.readable ? ` — ${a.transcriptCount}${a.transcriptCount >= 40 ? '+' : ''}` : ' — unavailable'}
                  </option>
                ))}
              </select>
            </div>
            <ArrowRight size={14} style={{ color: 'var(--ins-mist-500)', marginBottom: '9px' }} />
            <div>
              <label className="ins-field-label" htmlFor="tgtapp">To</label>
              <select id="tgtapp" className="ins-select" value={targetApp} disabled={readableApps.length === 0} onChange={e => setTargetApp(e.target.value)}>
                {targetOptions.length === 0 && <option value="">—</option>}
                {targetOptions.map(a => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>

          {convertMsg && (
            <div className={`ins-note ${convertMsg.ok ? 'ins-note--ok' : 'ins-note--error'}`}>{convertMsg.text}</div>
          )}

          <button
            className="ins-btn"
            disabled={converting || !sourceApp || !targetApp}
            onClick={handleConvertTranscripts}
            style={{ justifyContent: 'center', marginTop: 'auto' }}
          >
            {converting ? 'Converting…' : 'Convert transcripts'}
          </button>
        </div>
      </div>
    </div>
  );
};
