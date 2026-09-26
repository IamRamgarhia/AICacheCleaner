import React from 'react';
import type { AISoftwareAppItem } from '../types';
import { AISoftwareTab } from './AISoftwareTab';

interface AutoBotsTabProps {
  onKillBot?: (pid: number) => void;
  onOpenFolder?: (path: string) => void;
  onNavigate?: (tab: string) => void;
}

// Agents, crawlers, headless browsers and the MCP servers / skills they use.
const AGENTISH = /agent|crawler|browser|mcp|skills|autonomous|scrap/i;
const isAgent = (s: AISoftwareAppItem) => AGENTISH.test(`${s.name} ${s.category}`);

/** The Installed AI tools list, narrowed to agents and crawlers. */
export const AutoBotsTab: React.FC<AutoBotsTabProps> = ({ onKillBot, onOpenFolder, onNavigate }) => (
  <AISoftwareTab
    title="Agents & crawlers"
    subtitle="Coding agents, autonomous agents, headless browsers, MCP servers and agent skills on this machine — these often leave large browser binaries and caches behind."
    only={isAgent}
    onKillProcess={onKillBot ?? (() => undefined)}
    onOpenFolder={onOpenFolder}
    onNavigate={onNavigate}
  />
);
