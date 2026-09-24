import React, { useEffect, useState } from 'react';
import { fileIcon } from '../lib/native';
import { toolColor } from '../lib/toolColors';
import { brandFor, markColor } from '../lib/brandIcons';

interface AppIconProps {
  name: string;
  category?: string;
  iconPath?: string;
  /** The app's own icon, already extracted by the engine. */
  iconDataUrl?: string;
  large?: boolean;
}

/**
 * The most real icon available: the app's own icon from its .exe (sent by the
 * engine, or read by the desktop shell), else the official brand mark, else
 * its initial on its colour.
 */
export const AppIcon: React.FC<AppIconProps> = ({ name, category, iconPath, iconDataUrl, large = false }) => {
  const [shellIcon, setShellIcon] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setShellIcon(null);
    if (!iconDataUrl && iconPath) void fileIcon(iconPath).then(url => { if (alive) setShellIcon(url); });
    return () => { alive = false; };
  }, [iconPath, iconDataUrl]);

  const cls = `ins-appicon${large ? ' ins-appicon--lg' : ''}`;
  const src = iconDataUrl ?? shellIcon;
  if (src) return <span className={cls} aria-hidden><img src={src} alt="" /></span>;

  const brand = brandFor(name, category);
  if (brand) {
    return (
      <span className={`${cls} ins-appicon--brand`} aria-hidden>
        <svg viewBox="0 0 24 24" fill={markColor(brand.hex)}><path d={brand.path} /></svg>
      </span>
    );
  }
  return (
    <span className={cls} style={{ background: toolColor(name) }} aria-hidden>
      {name.replace(/^[^a-z0-9]+/i, '').charAt(0).toUpperCase()}
    </span>
  );
};
