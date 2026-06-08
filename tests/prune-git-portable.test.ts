import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { prunePortableGitRuntime } from "../scripts/prune-git-portable.js";

const silent = { log() {} };

function touch(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "x");
}

// Simulate the PortableGit runtime subset used by the installer.
function buildFakeRuntime(root) {
  // Required runtime files.
  for (const keep of [
    "cmd/git.exe",
    "bin/bash.exe",
    "bin/sh.exe",
    "usr/bin/bash.exe",
    "usr/bin/msys-2.0.dll",
    "mingw64/bin/git.exe",
    "mingw32/bin/git.exe",
    "mingw64/bin/libcrypto-3-x64.dll",
    "usr/bin/grep.exe",
    "usr/bin/sed.exe",
    "usr/bin/gawk.exe",
    "usr/bin/cat.exe",
    "usr/bin/find.exe",
    "etc/profile",
    "etc/fstab",
    "mingw64/bin/ash.exe",
    "mingw64/bin/busybox.exe",
  ]) touch(path.join(root, keep));

  // Files and directories that should be pruned.
  for (const drop of [
    "mingw64/share/doc/git-doc/git.html",
    "usr/share/man/man1/git.1",
    "usr/share/info/dir",
    "usr/include/foo.h",
    "usr/lib/perl5/core_perl/Foo.pm",
    "usr/share/perl5/core_perl/Bar.pm",
    "mingw64/lib/perl5/Baz.pm",
    "mingw32/lib/perl5/Baz.pm",
    "mingw64/lib/tcl8.6/init.tcl",
    "mingw32/lib/tcl8.6/init.tcl",
    "mingw64/lib/tk8.6/tk.tcl",
    "mingw32/lib/tk8.6/tk.tcl",
    "mingw64/lib/itcl4.2/itcl.tcl",
    "mingw32/lib/itcl4.2/itcl.tcl",
    "mingw64/share/git-gui/lib/git-gui.tcl",
    "mingw32/share/git-gui/lib/git-gui.tcl",
    "mingw64/share/gitk/lib/msgs/de.msg",
    "mingw32/share/gitk/lib/msgs/de.msg",
    "mingw64/share/gitweb/gitweb.cgi",
    "mingw32/share/gitweb/gitweb.cgi",
    "mingw64/share/locale/de/LC_MESSAGES/git.mo",
    "mingw32/share/locale/de/LC_MESSAGES/git.mo",
    "usr/share/locale/fr/LC_MESSAGES/coreutils.mo",
    "mingw64/lib/pkgconfig/zlib.pc",
    "mingw32/lib/pkgconfig/zlib.pc",
    "mingw64/lib/cmake/foo/bar.cmake",
    "mingw32/lib/cmake/foo/bar.cmake",
    "mingw64/share/aclocal/foo.m4",
    "mingw32/share/aclocal/foo.m4",
    "usr/share/vim/vim91/syntax/c.vim",
    "usr/bin/perl.exe",
    "usr/bin/vim.exe",
    "usr/bin/vimdiff.exe",
    "usr/bin/nano.exe",
    "mingw64/bin/wish86.exe",
    "mingw32/bin/wish86.exe",
    "mingw64/bin/tclsh86.exe",
    "mingw32/bin/tclsh86.exe",
    "mingw64/bin/perl.exe",
    "mingw32/bin/perl.exe",
    "mingw64/bin/svn.exe",
    "mingw32/bin/svn.exe",
    "git-bash.exe",
    "git-cmd.exe",
    "cmd/git-gui.exe",
    "cmd/gitk.exe",
    "cmd/start-ssh-agent.cmd",
    "mingw64/libexec/git-core/git-svn",
    "mingw32/libexec/git-core/git-svn",
    "mingw64/libexec/git-core/git-send-email",
    "mingw32/libexec/git-core/git-send-email",
    "mingw64/libexec/git-core/git-add--interactive",
    "mingw32/libexec/git-core/git-add--interactive",
    "mingw64/libexec/git-core/git-gui",
    "mingw32/libexec/git-core/git-gui",
    "mingw64/libexec/git-core/gitk",
    "mingw32/libexec/git-core/gitk",
    "mingw64/libexec/git-core/git-cvsserver",
    "mingw32/libexec/git-core/git-cvsserver",
  ]) touch(path.join(root, drop));
}

describe("prune-git-portable", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pg-prune-"));
    buildFakeRuntime(root);
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("removes docs headers scripting runtimes gui files locales editors and launchers", () => {
    prunePortableGitRuntime(root, { logger: silent });
    for (const gone of [
      "mingw64/share/doc/git-doc/git.html",
      "usr/share/man/man1/git.1",
      "usr/share/info/dir",
      "usr/include/foo.h",
      "usr/lib/perl5/core_perl/Foo.pm",
      "usr/share/perl5/core_perl/Bar.pm",
      "mingw64/lib/perl5/Baz.pm",
      "mingw64/lib/tcl8.6/init.tcl",
      "mingw64/lib/tk8.6/tk.tcl",
      "mingw64/lib/itcl4.2/itcl.tcl",
      "mingw64/share/git-gui/lib/git-gui.tcl",
      "mingw64/share/gitk/lib/msgs/de.msg",
      "mingw64/share/gitweb/gitweb.cgi",
      "mingw64/share/locale/de/LC_MESSAGES/git.mo",
      "usr/share/locale/fr/LC_MESSAGES/coreutils.mo",
      "mingw64/lib/pkgconfig/zlib.pc",
      "mingw64/lib/cmake/foo/bar.cmake",
      "mingw64/share/aclocal/foo.m4",
      "usr/share/vim/vim91/syntax/c.vim",
      "usr/bin/perl.exe",
      "usr/bin/vim.exe",
      "usr/bin/vimdiff.exe",
      "usr/bin/nano.exe",
      "mingw64/bin/wish86.exe",
      "mingw64/bin/tclsh86.exe",
      "mingw64/bin/perl.exe",
      "mingw64/bin/svn.exe",
      "git-bash.exe",
      "git-cmd.exe",
      "cmd/git-gui.exe",
      "cmd/gitk.exe",
      "cmd/start-ssh-agent.cmd",
      "mingw64/libexec/git-core/git-svn",
      "mingw64/libexec/git-core/git-send-email",
      "mingw64/libexec/git-core/git-add--interactive",
      "mingw64/libexec/git-core/git-gui",
      "mingw64/libexec/git-core/gitk",
      "mingw64/libexec/git-core/git-cvsserver",
    ]) {
      expect(fs.existsSync(path.join(root, gone)), `should remove ${gone}`).toBe(false);
    }
  });

  it("keeps git bash msys dll coreutils etc and legacy shell files", () => {
    prunePortableGitRuntime(root, { logger: silent });
    for (const kept of [
      "cmd/git.exe",
      "bin/bash.exe",
      "bin/sh.exe",
      "usr/bin/bash.exe",
      "usr/bin/msys-2.0.dll",
      "mingw64/bin/git.exe",
      "mingw32/bin/git.exe",
      "mingw64/bin/libcrypto-3-x64.dll",
      "usr/bin/grep.exe",
      "usr/bin/sed.exe",
      "usr/bin/gawk.exe",
      "usr/bin/cat.exe",
      "usr/bin/find.exe",
      "etc/profile",
      "etc/fstab",
      "mingw64/bin/ash.exe",
      "mingw64/bin/busybox.exe",
    ]) {
      expect(fs.existsSync(path.join(root, kept)), `should keep ${kept}`).toBe(true);
    }
  });

  it("reports removals in dry-run without deleting files", () => {
    const stats = prunePortableGitRuntime(root, { dryRun: true, logger: silent });
    expect(fs.existsSync(path.join(root, "usr/bin/perl.exe"))).toBe(true);
    expect(fs.existsSync(path.join(root, "mingw64/share/doc/git-doc/git.html"))).toBe(true);
    expect(stats.removedFiles).toBeGreaterThan(0);
    expect(stats.removedDirs).toBeGreaterThan(0);
  });

  it("is idempotent on a second run", () => {
    prunePortableGitRuntime(root, { logger: silent });
    const second = prunePortableGitRuntime(root, { logger: silent });
    expect(second.removedFiles).toBe(0);
    expect(second.removedDirs).toBe(0);
  });

  it("throws when pruning leaves required runtime files missing", () => {
    fs.rmSync(path.join(root, "bin/bash.exe"));
    fs.rmSync(path.join(root, "usr/bin/bash.exe"));
    expect(() => prunePortableGitRuntime(root, { logger: silent }))
      .toThrow(/missing required runtime files/);
  });

  it("throws when runtime root is missing", () => {
    expect(() => prunePortableGitRuntime(path.join(root, "nope"), { logger: silent }))
      .toThrow(/runtime root not found/);
  });
});
