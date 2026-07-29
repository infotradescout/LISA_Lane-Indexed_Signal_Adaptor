import fs from "node:fs";
import path from "node:path";

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

async function moveToUniquePath(sourcePath, targetDir, fileName) {
  const parsed = path.parse(fileName);
  let attempt = 0;

  while (attempt < 1000) {
    const suffix = attempt === 0 ? "" : "." + attempt;
    const candidate = path.join(targetDir, parsed.name + suffix + parsed.ext);
    try {
      await fs.promises.rename(sourcePath, candidate);
      return candidate;
    } catch (err) {
      if (err && err.code === "EEXIST") {
        attempt += 1;
        continue;
      }
      throw err;
    }
  }

  throw new Error("unable to move file after many attempts: " + fileName);
}

export function startInboxWatcher({
  enabled,
  inboxDir,
  archiveDir,
  failedDir,
  pollMs,
  onPacket,
  onError,
}) {
  const stats = {
    enabled: !!enabled,
    inbox_dir: inboxDir,
    archive_dir: archiveDir,
    failed_dir: failedDir,
    poll_ms: pollMs,
    last_scan_at: null,
    last_file_at: null,
    files_processed: 0,
    files_failed: 0,
    last_error: null,
  };

  if (!enabled) {
    return {
      stop: () => {},
      getStats: () => ({ ...stats }),
    };
  }

  let timer = null;
  let closed = false;
  let scanning = false;

  async function processOneFile(entryName) {
    const sourcePath = path.join(inboxDir, entryName);
    const claimingPath = sourcePath + ".processing";

    try {
      await fs.promises.rename(sourcePath, claimingPath);
    } catch {
      return;
    }

    try {
      const raw = await fs.promises.readFile(claimingPath, "utf8");
      const packet = JSON.parse(raw);
      await onPacket(packet, { fileName: entryName, filePath: claimingPath });
      await moveToUniquePath(claimingPath, archiveDir, entryName);
      stats.files_processed += 1;
      stats.last_file_at = nowIso();
    } catch (err) {
      stats.files_failed += 1;
      stats.last_error = String(err?.message || err || "unknown inbox watcher error");
      try {
        await moveToUniquePath(claimingPath, failedDir, entryName);
      } catch (moveErr) {
        stats.last_error =
          stats.last_error + "; failed move error: " + String(moveErr?.message || moveErr);
      }
      try {
        onError?.(err, { fileName: entryName, filePath: claimingPath });
      } catch {
        // Keep watcher alive even if error callback fails.
      }
    }
  }

  async function scanOnce() {
    if (scanning || closed) return;
    scanning = true;
    stats.last_scan_at = nowIso();

    try {
      await ensureDir(inboxDir);
      await ensureDir(archiveDir);
      await ensureDir(failedDir);

      const entries = await fs.promises.readdir(inboxDir, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => name.toLowerCase().endsWith(".json"))
        .sort((a, b) => a.localeCompare(b));

      for (const fileName of files) {
        if (closed) break;
        await processOneFile(fileName);
      }
    } catch (err) {
      stats.last_error = String(err?.message || err || "inbox scan error");
      try {
        onError?.(err, { fileName: null, filePath: inboxDir });
      } catch {
        // Ignore secondary callback errors.
      }
    } finally {
      scanning = false;
    }
  }

  async function tick() {
    await scanOnce();
    if (!closed) {
      timer = setTimeout(tick, pollMs);
    }
  }

  timer = setTimeout(tick, 0);

  return {
    stop: () => {
      closed = true;
      if (timer) clearTimeout(timer);
    },
    getStats: () => ({ ...stats }),
  };
}
