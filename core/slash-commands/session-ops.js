import fs from "fs";
import path from "path";

/**
 * @typedef {{kind:'bridge'|'desktop', agentId:string, sessionKey?:string, sessionPath?:string}} SessionRef
 * @typedef {{status:'not-found'|'no-history'|'rotated'|'deleted'}} SessionOpResult
 */

export function createSessionOps({ engine }) {
  return {
    isStreaming(ref) {
      if (ref.kind === "bridge") return engine.isBridgeSessionStreaming(ref.sessionKey);
      return engine.isSessionStreaming?.(ref.sessionPath) ?? false;
    },

    async abort(ref) {
      if (ref.kind === "bridge") return engine.abortBridgeSession(ref.sessionKey);
      return engine.abortSession?.(ref.sessionPath) ?? false;
    },

    /**
     * @throws {Error} 当 ref.kind === 'desktop'（Phase 1 未实现；项目底线禁止静默 no-op）
     */
    injectAssistantMessage(ref, text) {
      if (ref.kind === "bridge") {
        const ok = engine.bridgeSessionManager?.injectMessage(ref.sessionKey, text, { agentId: ref.agentId });
        return ok ?? false;
      }
      // C2 fix：desktop kind 不静默 no-op，显式 throw 让调用方知道未实现
      throw new Error(`injectAssistantMessage: desktop kind not supported in phase 1 (agentId=${ref.agentId})`);
    },

    async rotate(ref) {
      if (ref.kind !== "bridge") throw new Error("rotate for desktop kind not supported in phase 1");
      return _rotateBridge(engine, ref);
    },

    async delete(ref) {
      if (ref.kind !== "bridge") throw new Error("delete for desktop kind not supported in phase 1");
      return _deleteBridge(engine, ref);
    },

    async compact(ref) {
      if (ref.kind === "bridge") {
        // Phase 1 占位：bridge SDK 默认在 contextWindow-16384 自动压缩；
        // 手动触发需要 open session + 临时 Agent instance，留 Phase 2+
        // 注意：消息文案暂硬编码中文，后续 phase 统一 i18n 时迁移到 t()
        const ok = engine.bridgeSessionManager?.injectMessage(ref.sessionKey, "[上下文已压缩]", { agentId: ref.agentId });
        // I3 fix：inject 失败时 throw，不静默（ok !== true 同时 cover false 和 undefined——bridgeSessionManager 缺失时）
        if (ok !== true) throw new Error(`compact: injectMessage failed for bridge session ${ref.sessionKey}`);
        return;
      }
      const session = engine.getSessionByPath?.(ref.sessionPath);
      if (!session) throw new Error("session not found");
      if (session.isCompacting) throw new Error("Already compacting");
      await session.compact();
    },
  };
}

/**
 * 生成 archived 文件名。C1 fix：拒绝非 .jsonl 后缀，防 rename-to-self 导致数据丢失。
 * M4 fix：加 6 字符随机后缀，避免同毫秒冲突。
 */
function _archivedFilename(file, ts) {
  if (!file.endsWith(".jsonl")) {
    throw new Error(`_archivedFilename: entry.file must end with .jsonl, got "${file}"`);
  }
  const rand = Math.random().toString(36).slice(2, 8);
  return file.replace(/\.jsonl$/, `.archived-${ts}-${rand}.jsonl`);
}

function _rotateBridge(engine, ref) {
  const agent = engine.getAgent(ref.agentId);
  if (!agent) throw new Error("agent not found");
  const bridgeDir = path.join(agent.sessionDir, "bridge");
  const index = engine.bridgeSessionManager.readIndex(agent);
  const raw = index[ref.sessionKey];
  if (!raw) return { status: "not-found" };
  const entry = typeof raw === "string" ? { file: raw } : { ...raw };
  if (!entry.file) {
    index[ref.sessionKey] = entry;
    engine.bridgeSessionManager.writeIndex(index, agent);
    return { status: "no-history" };
  }
  const src = path.join(bridgeDir, entry.file);
  if (fs.existsSync(src)) {
    const archived = _archivedFilename(entry.file, Date.now());
    fs.renameSync(src, path.join(bridgeDir, archived));
  }
  delete entry.file;
  index[ref.sessionKey] = entry;
  engine.bridgeSessionManager.writeIndex(index, agent);
  return { status: "rotated" };
}

function _deleteBridge(engine, ref) {
  const agent = engine.getAgent(ref.agentId);
  if (!agent) throw new Error("agent not found");
  const bridgeDir = path.join(agent.sessionDir, "bridge");
  const index = engine.bridgeSessionManager.readIndex(agent);
  const raw = index[ref.sessionKey];
  if (!raw) return { status: "not-found" };
  const entry = typeof raw === "string" ? { file: raw } : raw;
  if (entry.file) {
    const p = path.join(bridgeDir, entry.file);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  delete index[ref.sessionKey];
  engine.bridgeSessionManager.writeIndex(index, agent);
  return { status: "deleted" };
}
