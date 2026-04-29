import fs from "fs";
import path from "path";
import { t } from "../../server/i18n.js";
import {
  BLOCKED_FILES,
  BLOCKED_DIRS,
  READ_ONLY_AGENT_FILES,
  READ_ONLY_AGENT_DIRS,
  READ_ONLY_HOME_DIRS,
  READ_WRITE_AGENT_DIRS,
  READ_WRITE_AGENT_FILES,
  READ_WRITE_HOME_DIRS,
} from "./policy.js";

export const AccessLevel = {
  BLOCKED: "blocked",
  READ_ONLY: "read_only",
  READ_WRITE: "read_write",
  FULL: "full",
};

const OP_REQUIREMENTS = {
  read: new Set([AccessLevel.READ_ONLY, AccessLevel.READ_WRITE, AccessLevel.FULL]),
  write: new Set([AccessLevel.READ_WRITE, AccessLevel.FULL]),
  delete: new Set([AccessLevel.FULL]),
};

export class PathGuard {
  constructor(policy) {
    if (policy.mode === "full-access") {
      this._fullAccess = true;
      return;
    }

    this._fullAccess = false;
    this.hanakoHome = this._resolveReal(policy.hanakoHome) || path.resolve(policy.hanakoHome);
    this.agentDir = this._resolveReal(policy.agentDir) || path.resolve(policy.agentDir);

    const roots = Array.isArray(policy.workspaceRoots) && policy.workspaceRoots.length > 0
      ? policy.workspaceRoots
      : [policy.workspace].filter(Boolean);
    this.workspaceRoots = roots.map((root) => this._resolveReal(root) || path.resolve(root));
    this.extraReadOnlyPaths = (policy.extraReadOnlyPaths || [])
      .map((root) => this._resolveReal(root) || path.resolve(root));
  }

  _resolveReal(rawPath) {
    const abs = path.resolve(rawPath);
    try {
      return fs.realpathSync(abs);
    } catch (err) {
      if (err.code !== "ENOENT") return null;

      const pending = [];
      let current = abs;
      while (true) {
        const parent = path.dirname(current);
        if (parent === current) return null;
        pending.push(path.basename(current));
        try {
          const realParent = fs.realpathSync(parent);
          pending.reverse();
          return path.join(realParent, ...pending);
        } catch (nextErr) {
          if (nextErr.code !== "ENOENT") return null;
          current = parent;
        }
      }
    }
  }

  _isInside(target, base) {
    return target === base || target.startsWith(base + path.sep);
  }

  getAccessLevel(rawPath) {
    const resolved = this._resolveReal(rawPath);
    if (!resolved) return AccessLevel.BLOCKED;

    for (const name of BLOCKED_FILES) {
      if (resolved === path.join(this.hanakoHome, name)) return AccessLevel.BLOCKED;
    }

    for (const name of BLOCKED_DIRS) {
      if (this._isInside(resolved, path.join(this.hanakoHome, name))) {
        return AccessLevel.BLOCKED;
      }
    }

    for (const name of READ_ONLY_AGENT_FILES) {
      if (resolved === path.join(this.agentDir, name)) return AccessLevel.READ_ONLY;
    }

    for (const name of READ_ONLY_AGENT_DIRS) {
      if (this._isInside(resolved, path.join(this.agentDir, name))) {
        return AccessLevel.READ_ONLY;
      }
    }

    for (const name of READ_ONLY_HOME_DIRS) {
      if (this._isInside(resolved, path.join(this.hanakoHome, name))) {
        return AccessLevel.READ_ONLY;
      }
    }

    for (const name of READ_WRITE_AGENT_DIRS) {
      if (this._isInside(resolved, path.join(this.agentDir, name))) {
        return AccessLevel.READ_WRITE;
      }
    }

    for (const name of READ_WRITE_AGENT_FILES) {
      if (resolved === path.join(this.agentDir, name)) return AccessLevel.READ_WRITE;
    }

    for (const name of READ_WRITE_HOME_DIRS) {
      if (this._isInside(resolved, path.join(this.hanakoHome, name))) {
        return AccessLevel.READ_WRITE;
      }
    }

    if (this._isInside(resolved, this.hanakoHome)) return AccessLevel.BLOCKED;

    for (const root of this.extraReadOnlyPaths) {
      if (this._isInside(resolved, root)) {
        return AccessLevel.READ_ONLY;
      }
    }

    for (const root of this.workspaceRoots) {
      if (this._isInside(resolved, root)) {
        return AccessLevel.FULL;
      }
    }

    return AccessLevel.BLOCKED;
  }

  check(absolutePath, operation) {
    if (this._fullAccess) return { allowed: true };
    const level = this.getAccessLevel(absolutePath);
    const allowed = OP_REQUIREMENTS[operation]?.has(level) ?? false;
    if (allowed) return { allowed: true };

    const resolved = this._resolveReal(absolutePath) || absolutePath;
    const opLabel = {
      read: t("sandbox.opRead"),
      write: t("sandbox.opWrite"),
      delete: t("sandbox.opDelete"),
    }[operation] || operation;

    return {
      allowed: false,
      reason: t("sandbox.denied", { op: opLabel, path: resolved, level }),
    };
  }
}
