/**
 * Prune parts of PortableGit that are not needed by the agent runtime.
 *
 * Design notes:
 *   1. Use a conservative delete-list for docs, man pages, headers, GUI, Tcl/Tk,
 *      Perl, SVN/CVS, gitweb, locales, and editors. Do not delete DLLs.
 *   2. Fail fast if required runtime files are missing after pruning.
 *   3. Keep the implementation as plain fs operations so it works in CI and Windows.
 */
import fs from "fs";
import path from "path";

// Delete whole directory trees. Versioned directories use PRUNE_DIR_PREFIXES.
export const PRUNE_DIRS = [
  // Docs / man pages / info / headers.
  "mingw64/share/doc",
  "mingw32/share/doc",
  "usr/share/doc",
  "usr/share/man",
  "mingw64/share/man",
  "mingw32/share/man",
  "usr/share/info",
  "mingw64/share/info",
  "mingw32/share/info",
  "usr/include",
  "mingw64/include",
  "mingw32/include",
  // GUI / web frontend.
  "mingw64/share/git-gui",
  "mingw32/share/git-gui",
  "mingw64/share/gitk",
  "mingw32/share/gitk",
  "mingw64/share/gitweb",
  "mingw32/share/gitweb",
  // Perl userland.
  "usr/lib/perl5",
  "usr/share/perl5",
  "mingw64/lib/perl5",
  "mingw32/lib/perl5",
  "mingw64/share/perl5",
  "mingw32/share/perl5",
  // Locales are not needed for the bundled agent runtime.
  "mingw64/share/locale",
  "mingw32/share/locale",
  "usr/share/locale",
  // Development metadata.
  "mingw64/lib/pkgconfig",
  "mingw32/lib/pkgconfig",
  "usr/lib/pkgconfig",
  "mingw64/lib/cmake",
  "mingw32/lib/cmake",
  "mingw64/share/aclocal",
  "mingw32/share/aclocal",
  "usr/share/aclocal",
  // Editor resources.
  "usr/share/vim",
  "usr/share/nano",
];

// Delete child directories whose basename starts with a prefix, e.g. tcl8.6.
export const PRUNE_DIR_PREFIXES = [
  { parent: "mingw64/lib", prefix: "tcl" },
  { parent: "mingw64/lib", prefix: "tk" },
  { parent: "mingw64/lib", prefix: "itcl" },
  { parent: "mingw64/lib", prefix: "tdbc" },
  { parent: "mingw64/lib", prefix: "thread" },
  { parent: "mingw32/lib", prefix: "tcl" },
  { parent: "mingw32/lib", prefix: "tk" },
  { parent: "mingw32/lib", prefix: "itcl" },
  { parent: "mingw32/lib", prefix: "tdbc" },
  { parent: "mingw32/lib", prefix: "thread" },
];

// Delete files whose basename matches a rule.
export const PRUNE_FILES = [
  // Root launchers are not used; Hana spawns bin/bash.exe directly.
  { dir: "", names: ["git-bash.exe", "git-cmd.exe"] },
  // cmd launchers / GUI.
  { dir: "cmd", names: ["git-gui.exe", "gitk.exe", "git-bash.exe"], prefixes: ["start-"] },
  // GUI / scripting runtimes under mingw64/bin. Do not touch DLLs.
  { dir: "mingw64/bin", prefixes: ["wish", "tclsh", "perl", "svn", "vim"] },
  { dir: "mingw32/bin", prefixes: ["wish", "tclsh", "perl", "svn", "vim"] },
  // Perl runtime and interactive editors under usr/bin.
  {
    dir: "usr/bin",
    prefixes: ["perl"],
    names: ["vi.exe", "view.exe", "vim.exe", "vimdiff.exe", "rvim.exe", "rview.exe", "nano.exe"],
  },
  // Perl-based, SVN/CVS, and GUI git subcommands.
  {
    dir: "mingw64/libexec/git-core",
    names: [
      "git-svn",
      "git-send-email",
      "git-add--interactive",
      "git-archimport",
      "git-cvsimport",
      "git-cvsexportcommit",
      "git-cvsserver",
      "git-instaweb",
      "git-p4",
      "git-gui",
      "git-gui--askpass",
      "git-citool",
      "gitk",
    ],
  },
  {
    dir: "mingw32/libexec/git-core",
    names: [
      "git-svn",
      "git-send-email",
      "git-add--interactive",
      "git-archimport",
      "git-cvsimport",
      "git-cvsexportcommit",
      "git-cvsserver",
      "git-instaweb",
      "git-p4",
      "git-gui",
      "git-gui--askpass",
      "git-citool",
      "gitk",
    ],
  },
];

// Required after pruning. Keep this to files needed by installer/runtime checks.
export const RETAIN_ASSERTIONS = [
  "cmd/git.exe",
  "bin/bash.exe",
  "usr/bin/bash.exe",
  "usr/bin/msys-2.0.dll",
];

export const RETAIN_ANY_ASSERTIONS = [
  ["mingw64/bin/git.exe", "mingw32/bin/git.exe"],
];

function statPathUsage(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return { bytes: st.size, files: 1 };
  let bytes = 0;
  let files = 0;
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        files += 1;
        try {
          bytes += fs.statSync(p).size;
        } catch {}
      }
    }
  }
  return { bytes, files };
}

function removePath(target, dryRun) {
  const usage = statPathUsage(target);
  if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
  return usage;
}

export function prunePortableGitRuntime(root, { dryRun = false, logger = console } = {}) {
  if (!fs.existsSync(root)) {
    throw new Error(`[prune-git-portable] runtime root not found: ${root}`);
  }

  let removedDirs = 0;
  let removedFiles = 0;
  let removedBytes = 0;

  // 1. Whole directories.
  for (const rel of PRUNE_DIRS) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const { bytes } = removePath(abs, dryRun);
    removedDirs += 1;
    removedBytes += bytes;
  }

  // 2. Versioned directory prefixes.
  for (const { parent, prefix } of PRUNE_DIR_PREFIXES) {
    const parentAbs = path.join(root, parent);
    let entries = [];
    try {
      entries = fs.readdirSync(parentAbs, { withFileTypes: true });
    } catch {}
    for (const e of entries) {
      if (e.isDirectory() && e.name.toLowerCase().startsWith(prefix)) {
        const { bytes } = removePath(path.join(parentAbs, e.name), dryRun);
        removedDirs += 1;
        removedBytes += bytes;
      }
    }
  }

  // 3. Files.
  for (const rule of PRUNE_FILES) {
    const dirAbs = path.join(root, rule.dir);
    let entries = [];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {}
    for (const e of entries) {
      if (!e.isFile()) continue;
      const name = e.name;
      const lower = name.toLowerCase();
      const hit =
        (rule.names || []).includes(name) ||
        (rule.names || []).includes(lower) ||
        (rule.prefixes || []).some((p) => lower.startsWith(p));
      if (!hit) continue;
      const { bytes } = removePath(path.join(dirAbs, name), dryRun);
      removedFiles += 1;
      removedBytes += bytes;
    }
  }

  // 4. Fail fast if pruning leaves an incomplete runtime.
  const missing = [
    ...RETAIN_ASSERTIONS.filter((rel) => !fs.existsSync(path.join(root, rel))),
    ...RETAIN_ANY_ASSERTIONS
      .filter((group) => !group.some((rel) => fs.existsSync(path.join(root, rel))))
      .map((group) => group.join(" or ")),
  ];
  if (missing.length) {
    throw new Error(
      `[prune-git-portable] missing required runtime files after pruning:\n` +
        missing.map((m) => `  - ${m}`).join("\n"),
    );
  }

  const removedMB = +(removedBytes / 1048576).toFixed(1);
  const stats = { dryRun, removedDirs, removedFiles, removedMB };
  logger.log(
    `[prune-git-portable] ${dryRun ? "(dry-run) " : ""}` +
      `dirs=${removedDirs} files=${removedFiles} freed~${removedMB}MB`,
  );
  return stats;
}
