import fs from 'fs';
import path from 'path';
import os from 'os';
import { AISoftwareAppItem, AIProcessItem } from '../src/types';
import { getDirectorySize, formatBytes } from './scanner';

const homeDir = os.homedir();
const appDataLocal = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
const appDataRoaming = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

export async function detectInstalledAISoftware(runningProcesses: AIProcessItem[]): Promise<AISoftwareAppItem[]> {
  const softwareList: AISoftwareAppItem[] = [
    {
      id: 'sw-antigravity',
      name: 'Google Antigravity IDE & AGY Engine',
      category: 'Agentic Pairing & AI IDE',
      version: 'v2.4.0',
      status: 'INSTALLED ON DISK',
      detectionPaths: [
        path.join(homeDir, '.gemini'),
        path.join(appDataLocal, 'Programs', 'Antigravity'),
        path.join(appDataRoaming, 'antigravity')
      ],
      executableName: 'antigravity.exe',
      description: 'Google DeepMind agentic pair-programming assistant, AGY CLI, and multi-agent engine.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-cursor',
      name: 'Cursor AI Code Editor',
      category: 'AI IDE & Code Extensions',
      version: 'v0.45.2',
      status: 'INSTALLED ON DISK',
      detectionPaths: [
        path.join(homeDir, '.cursor'),
        path.join(appDataLocal, 'Programs', 'cursor'),
        path.join(appDataRoaming, 'Cursor')
      ],
      executableName: 'cursor.exe',
      description: 'AI-first code editor with local codebase indexing, prompt caching, and tab completion.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-claude',
      name: 'Claude Desktop App & Claude Code CLI',
      category: 'AI Assistant & Agent CLI',
      version: 'v1.2.0',
      status: 'INSTALLED ON DISK',
      detectionPaths: [
        path.join(homeDir, '.claude'),
        path.join(appDataRoaming, 'Claude'),
        path.join(appDataLocal, 'AnthropicClaude')
      ],
      executableName: 'claude.exe',
      description: 'Anthropic Claude desktop application, session transcripts, and terminal agent runner.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-ollama',
      name: 'Ollama Local LLM Engine & Weights',
      category: 'Local LLM Inference Engine',
      version: 'v0.5.1',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(homeDir, '.ollama'),
        path.join(appDataLocal, 'Ollama'),
        path.join(programFiles, 'Ollama')
      ],
      executableName: 'ollama.exe',
      description: 'Runs open-weight LLMs (Llama 3, Qwen 2.5, DeepSeek R1) 100% locally on GPU/CPU.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-vscode-mcp',
      name: 'VS Code AI Extensions & MCP Servers',
      category: 'IDE Sidecars & MCP Tooling',
      version: 'v1.96.0',
      status: 'INSTALLED ON DISK',
      detectionPaths: [
        path.join(homeDir, '.vscode'),
        path.join(appDataRoaming, 'Code')
      ],
      executableName: 'code.exe',
      description: 'Model Context Protocol (MCP) stdio sidecars, language servers, and extension caches.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-opendevin',
      name: 'OpenDevin Clawbot & Autonomous Agent',
      category: 'Autonomous AI Clawbot',
      version: 'v0.12.0',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(homeDir, '.opendevin'),
        path.join(appDataLocal, 'OpenDevin')
      ],
      executableName: 'python.exe',
      description: 'Autonomous open-source AI software engineer clawbot and containerized worker.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-crawl4ai',
      name: 'Crawl4AI Autonomous Crawler Bot',
      category: 'AI Web Crawler Bot',
      version: 'v0.4.2',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(homeDir, '.crawl4ai'),
        path.join(appDataLocal, 'Crawl4AI')
      ],
      executableName: 'python.exe',
      description: 'LLM-friendly web crawler bot engine for markdown extraction and RAG pipelines.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-playwright',
      name: 'Playwright & Puppeteer Headless Clawbots',
      category: 'Browser Clawbot Engines',
      version: 'v1.49.0',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(appDataLocal, 'ms-playwright'),
        path.join(homeDir, '.cache', 'puppeteer')
      ],
      description: 'Automated headless Chromium / Firefox binaries used by AI agents and scraping bots.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-jan',
      name: 'Jan.ai Offline LLM Studio',
      category: 'Local LLM Studio & Caches',
      version: 'v0.5.8',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(homeDir, '.jan'),
        path.join(appDataRoaming, 'Jan')
      ],
      executableName: 'jan.exe',
      description: 'Open-source offline ChatGPT alternative with local model weights.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-anythingllm',
      name: 'AnythingLLM Desktop Studio',
      category: 'All-in-One AI Desktop App',
      version: 'v1.7.2',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(appDataRoaming, 'AnythingLLM'),
        path.join(appDataLocal, 'Programs', 'AnythingLLM')
      ],
      executableName: 'anythingllm.exe',
      description: 'Desktop AI suite with built-in RAG vector database and local LLM connectors.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-huggingface-torch',
      name: 'HuggingFace & PyTorch Checkpoint Cache',
      category: 'ML Weights & Model Caches',
      version: 'v4.45.0',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(homeDir, '.cache', 'huggingface'),
        path.join(homeDir, '.cache', 'torch'),
        path.join(homeDir, '.cache', 'pip')
      ],
      description: 'Downloaded transformer weights, GGUF models, and PyTorch model checkpoints.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    },
    {
      id: 'sw-continue',
      name: 'Continue.dev AI Pair Programmer',
      category: 'AI Extension & Vector Index',
      version: 'v0.9.0',
      status: 'LAYING ON DISK (RESIDUAL)',
      detectionPaths: [
        path.join(homeDir, '.continue')
      ],
      description: 'Open-source AI code assistant vector embeddings and SQLite session database.',
      canUninstall: true,
      totalDiskSizeBytes: 0,
      formattedDiskSize: '0 B'
    }
  ];

  for (const sw of softwareList) {
    let totalBytes = 0;
    let anyPathExists = false;

    for (const p of sw.detectionPaths) {
      if (fs.existsSync(p)) {
        anyPathExists = true;
        totalBytes += getDirectorySize(p);
      }
    }

    sw.totalDiskSizeBytes = totalBytes;
    sw.formattedDiskSize = formatBytes(totalBytes);

    // Check if actively running in RAM
    const runningProc = runningProcesses.find(proc => 
      sw.executableName && proc.name.toLowerCase() === sw.executableName.toLowerCase() ||
      proc.tool.toLowerCase().includes(sw.id.replace('sw-', ''))
    );

    if (runningProc) {
      sw.status = 'ACTIVE IN RAM';
      sw.pid = runningProc.pid;
      sw.ramMb = runningProc.memoryMb;
      sw.cpuPercent = runningProc.cpuPercent;
    } else if (anyPathExists) {
      const hasExecutable = sw.detectionPaths.some(p => fs.existsSync(p) && (p.includes('Programs') || p.includes('Program Files') || p.includes('AppData')));
      sw.status = hasExecutable ? 'INSTALLED ON DISK' : 'LAYING ON DISK (RESIDUAL)';
    } else {
      sw.status = 'NOT INSTALLED';
    }
  }

  return softwareList;
}
