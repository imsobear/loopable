import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";

/** Tails a file that is being appended to, handing over each new piece. */
export function watchFile(path: string, onChunk: (chunk: string) => void): () => void {
  let offset = 0;
  const flush = () => {
    if (!existsSync(path)) return;
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size;
      if (size <= offset) return;
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      onChunk(buf.toString("utf8"));
    } finally {
      closeSync(fd);
    }
  };
  const timer = setInterval(flush, 400);
  return () => {
    clearInterval(timer);
    flush();
  };
}
