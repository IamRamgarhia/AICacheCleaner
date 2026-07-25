import { AIProcessItem } from '../src/types';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import pidusage from 'pidusage';

const execAsync = promisify(exec);

export async function scanAIProcesses(): Promise<AIProcessItem[]> {
  const isWindows = os.platform() === 'win32';
  const processes: AIProcessItem[] = [];

  try {
    if (isWindows) {
      const { stdout } = await execAsync('tasklist /FO CSV /NH');
      const lines = stdout.split('\r\n').filter(Boolean);

      const candidatePids: { pid: number; name: string; memMb: number }[] = [];

      for (const line of lines) {
        const cleanLine = line.replace(/"/g, '');
        const parts = cleanLine.split(',');
        if (parts.length >= 5) {
          const name = parts[0].trim();
          const pid = parseInt(parts[1].trim(), 10);
          const memKStr = parts.slice(4).join('').replace(/[^0-9]/g, '');
          const memKb = parseInt(memKStr, 10) || 0;
          const memMb = Math.round(memKb / 1024);

          const nameLower = name.toLowerCase();
          const isAiDevProcess = 
            nameLower.includes('node') ||
            nameLower.includes('python') ||
            nameLower.includes('py') ||
            nameLower.includes('ollama') ||
            nameLower.includes('cursor') ||
            nameLower.includes('antigravity') ||
            nameLower.includes('claude') ||
            nameLower.includes('electron') ||
            nameLower.includes('code') ||
            nameLower.includes('rg') ||
            nameLower.includes('codex') ||
            nameLower.includes('git') ||
            nameLower.includes('tsx') ||
            nameLower.includes('vite') ||
            nameLower.includes('npm') ||
            nameLower.includes('npx') ||
            nameLower.includes('cmd') ||
            nameLower.includes('powershell');

          if (isAiDevProcess && pid > 0) {
            candidatePids.push({ pid, name, memMb });
          }
        }
      }

      // Query real CPU metrics using pidusage
      const pidsToQuery = candidatePids.slice(0, 30).map(c => c.pid);
      let realStats: { [key: number]: any } = {};

      try {
        if (pidsToQuery.length > 0) {
          realStats = await pidusage(pidsToQuery);
        }
      } catch (e) {
        // Fallback to 0% CPU on query error
      }

      for (const candidate of candidatePids) {
        const stat = realStats[candidate.pid];
        const cpuPercent = stat ? parseFloat(stat.cpu.toFixed(1)) : 0;
        const memoryMb = stat ? Math.round(stat.memory / (1024 * 1024)) : candidate.memMb;
        const nameLower = candidate.name.toLowerCase();

        let toolName = 'AI Extension / Sidecar';
        if (nameLower.includes('antigravity')) toolName = 'Antigravity Subagent Worker';
        else if (nameLower.includes('cursor')) toolName = 'Cursor AI Language Extension';
        else if (nameLower.includes('claude')) toolName = 'Claude Desktop Sidecar';
        else if (nameLower.includes('ollama')) toolName = 'Ollama Local LLM Engine';
        else if (nameLower.includes('node')) toolName = 'MCP Stdio Language Server';
        else if (nameLower.includes('python') || nameLower.includes('py')) toolName = 'Python AI Crawler Engine';
        else if (nameLower.includes('code')) toolName = 'VS Code Language Host';
        else if (nameLower.includes('electron')) toolName = 'AI Desktop Electron App';
        else if (nameLower.includes('rg')) toolName = 'Ripgrep Vector Indexer';
        else if (nameLower.includes('vite') || nameLower.includes('tsx')) toolName = 'Localhost Web Dev Server';

        // Real zombie heuristic: High memory usage with 0% CPU activity (idle orphan process)
        const isZombie = memoryMb > 300 && cpuPercent < 0.2;

        processes.push({
          pid: candidate.pid,
          ppid: 1,
          name: candidate.name,
          tool: toolName,
          cpuPercent,
          memoryMb,
          formattedMemory: `${memoryMb} MB`,
          isZombie,
          command: `${candidate.name} (PID: ${candidate.pid})`
        });
      }
    } else {
      // macOS / Linux ps query
      const { stdout } = await execAsync('ps -ax -o pid,ppid,%cpu,rss,command');
      const lines = stdout.split('\n').filter(Boolean);

      for (const line of lines.slice(1)) {
        const tokens = line.trim().split(/\s+/);
        if (tokens.length >= 5) {
          const pid = parseInt(tokens[0], 10);
          const ppid = parseInt(tokens[1], 10);
          const cpuPercent = parseFloat(tokens[2]) || 0;
          const rssKb = parseInt(tokens[3], 10) || 0;
          const command = tokens.slice(4).join(' ');
          const memMb = Math.round(rssKb / 1024);

          const lowerCmd = command.toLowerCase();
          if (
            lowerCmd.includes('node') ||
            lowerCmd.includes('python') ||
            lowerCmd.includes('ollama') ||
            lowerCmd.includes('mcp') ||
            lowerCmd.includes('claude') ||
            lowerCmd.includes('cursor') ||
            lowerCmd.includes('antigravity')
          ) {
            let toolName = 'AI Sidecar Process';
            if (lowerCmd.includes('ollama')) toolName = 'Ollama Engine';
            if (lowerCmd.includes('mcp')) toolName = 'MCP Server Process';
            if (lowerCmd.includes('antigravity')) toolName = 'Antigravity Worker';

            processes.push({
              pid,
              ppid,
              name: tokens[4],
              tool: toolName,
              cpuPercent,
              memoryMb: memMb,
              formattedMemory: `${memMb} MB`,
              isZombie: ppid === 1 && cpuPercent < 0.2 && memMb > 300,
              command: command.length > 60 ? command.substring(0, 60) + '...' : command
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('Error scanning AI processes:', e);
  }

  return processes;
}

export async function killProcess(pid: number): Promise<boolean> {
  try {
    if (os.platform() === 'win32') {
      await execAsync(`taskkill /PID ${pid} /F`);
    } else {
      await execAsync(`kill -9 ${pid}`);
    }
    return true;
  } catch (e) {
    console.error(`Failed to kill process ${pid}:`, e);
    return false;
  }
}
