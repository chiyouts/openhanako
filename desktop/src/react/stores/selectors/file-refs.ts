import type { FileRef } from '../../types/file-ref';
import type { DeskFile } from '../../types';
import { inferKindByExt, buildFileRefId } from '../../utils/file-kind';

type StateShape = {
  deskFiles: DeskFile[];
  deskBasePath: string;
  deskCurrentPath: string;
  chatSessions?: Record<string, any>;
};

function joinPath(base: string, sub: string, name: string): string {
  // 保持 OS 原生习惯：仅用正斜杠拼接（preload 层自行适配 Windows 反斜杠）
  const parts = [base, sub, name].filter(Boolean);
  return parts.join('/').replace(/\/+/g, '/');
}

function extOf(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return undefined;
  return name.slice(dot + 1);
}

// ── Desk ──

let cachedDesk: { files: DeskFile[]; basePath: string; currentPath: string; result: FileRef[] } | null = null;

export function selectDeskFiles(state: StateShape): FileRef[] {
  const { deskFiles, deskBasePath, deskCurrentPath } = state;
  if (
    cachedDesk
    && cachedDesk.files === deskFiles
    && cachedDesk.basePath === deskBasePath
    && cachedDesk.currentPath === deskCurrentPath
  ) {
    return cachedDesk.result;
  }
  const result: FileRef[] = [];
  for (const f of deskFiles) {
    if (f.isDir) continue;
    const path = joinPath(deskBasePath, deskCurrentPath, f.name);
    const ext = extOf(f.name);
    result.push({
      id: buildFileRefId({ source: 'desk', path }),
      kind: inferKindByExt(ext),
      source: 'desk',
      name: f.name,
      path,
      ext,
    });
  }
  cachedDesk = { files: deskFiles, basePath: deskBasePath, currentPath: deskCurrentPath, result };
  return result;
}
