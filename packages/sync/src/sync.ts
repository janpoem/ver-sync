import color from 'ansi-colors';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import * as readline from 'node:readline';
import type { ChangedRecord, SyncOptions, SyncResult } from './_types';
import {
  dateFormat,
  extractChangedRecord,
  isDir,
  listFiles,
  loadSyncLog,
  syncStore,
} from './_utils';

const output = console.log;

export async function sync({
  entry,
  ext,
  logFile,
  saveLog = true,
  onFiles,
  orderFiles,
  onChangeFiles,
  store: storeImpl,
  onSync,
  onLog,
  confirm,
  cwd: iCwd,
  changed: changedOpts,
  glob: globOpts,
}: SyncOptions): Promise<SyncResult> {
  const cwd = iCwd || process.cwd();

  logFile = logFile || 'sync.json';
  const logPath = isAbsolute(logFile) ? logFile : resolve(cwd, logFile);
  const log = loadSyncLog(logPath);

  const files = await listFiles(entry, ext || '', cwd, globOpts, orderFiles);
  await onFiles?.(files);
  const changedFiles = await extractChangedRecord(files, log, changedOpts);
  await onChangeFiles?.(changedFiles);

  const changedKeys = Object.keys(changedFiles);
  const changedCount = changedKeys.length;

  const result = {
    files,
    changedFiles,
    log,
    isConfirm: true,
  };

  if (changedCount <= 0) {
    output('There are no files to sync yet!');
    return result;
  }

  const doSync = async () => {
    const now = Math.floor(Date.now() / 1000);
    const syncFiles = await syncStore(changedFiles, storeImpl);
    if (Object.keys(syncFiles).length > 0) {
      log.files = { ...log.files, ...syncFiles };
      log.lastSync = now;
      await onLog?.({ files, changedFiles, syncFiles, log });
      if (saveLog) {
        writeJsonData(logPath, log);
      }
    }
    await onSync?.({ files, changedFiles, syncFiles, log });
  };

  const doConfirm = (
    handle: (answer: string) => Promise<boolean> | boolean,
  ) => {
    return new Promise<boolean>((resolve, reject) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(
        'Are you sure want to sync the above files? [y|enter|n] ',
        (answer) => {
          const res = handle(answer);
          res ? output(color.green('Yes')) : output(color.red('No'));
          rl.close();
          resolve(res);
        },
      );
    });
  };

  output(
    `There are ${color.cyanBright(`${changedCount}`)} file(s) to be synced:`,
  );
  listChangedFiles(changedFiles);

  if (confirm) {
    result.isConfirm = await doConfirm(
      (input) => input.toLowerCase() === 'y' || input === '',
    );
  }

  if (result.isConfirm) await doSync();

  return result;
}

export function listChangedFiles(changedFiles: ChangedRecord): void {
  type Sizes = [number, number];
  const [maxKeyWidth, maxSizeWidth] = Object.entries(changedFiles).reduce(
    (res, [key, file]) => {
      const values: Sizes = [key.length, file.size.length];
      return res.map((it, idx) => Math.max(it, values[idx] ?? 0)) as Sizes;
    },
    [0, 0] as Sizes,
  );

  for (const [key, file] of Object.entries(changedFiles)) {
    output(
      [
        color.cyanBright(key + ' '.repeat(maxKeyWidth - key.length)),
        color.gray(': '),
        color.blue(' '.repeat(maxSizeWidth - file.size.length) + file.size),
        color.gray(', '),
        color.green(dateFormat(file.mtime)),
        color.gray(', '),
        color.yellow(file.hash),
        color.gray(' => '),
        color.magenta(file.verPath),
      ].join(''),
    );
  }
}

function writeJsonData(path: string, log: unknown) {
  const dir = dirname(path);
  if (!isDir(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(log, null, 2));
}
