import path from "node:path";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { importDocument } from "./importer";
import { categories, filterEvents, type Archive, type EventQuery, type EventRepository } from "./model";

export function archiveRoot() { return path.resolve(process.env.ARCHIVE_ROOT ?? path.join(process.cwd(), "..")); }

export class MarkdownEventRepository implements EventRepository {
  private cached?: { signature: string; archive: Archive };
  async getArchive(): Promise<Archive> {
    // Resolve the release once: a publication must not mix files from two snapshots.
    const root = await realpath(archiveRoot());
    const files = (await Promise.all(categories.map(async category => {
      const directory = path.join(root, category);
      const names = await readdir(directory);
      return Promise.all(names.filter(name => /^\d{1,4}\.md$/.test(name)).sort().map(async name => {
        const fullPath = path.join(directory, name);
        const info = await stat(fullPath);
        return { category, name, fullPath, mtime: info.mtimeMs, size: info.size };
      }));
    }))).flat();
    const signature = files.map(f => `${f.fullPath}:${f.mtime}:${f.size}`).join("|");
    if (this.cached?.signature === signature) return this.cached.archive;
    const imported = await Promise.all(files.map(async file => importDocument(await readFile(file.fullPath, "utf8"), `${file.category}/${file.name}`, file.category, Number.parseInt(file.name))));
    const events = imported.flatMap(result => result.events).sort((a, b) => (a.date.earliest ?? `${a.source.year}-99`).localeCompare(b.date.earliest ?? `${b.source.year}-99`) || a.id.localeCompare(b.id));
    const ids = new Set<string>();
    for (const event of events) {
      if (ids.has(event.id)) throw new Error(`Event ID collision: ${event.id}`);
      ids.add(event.id);
    }
    const years = new Set(files.map(file => Number.parseInt(file.name)));
    for (const event of events) {
      if (event.date.earliest && event.date.latest) {
        for (let year = Number(event.date.earliest.slice(0, 4)); year <= Number(event.date.latest.slice(0, 4)); year++) years.add(year);
      }
    }
    const archive: Archive = { events, years: [...years].sort((a, b) => b - a), files: files.length, dateBlocks: imported.reduce((sum, i) => sum + i.dateBlocks, 0), issues: imported.flatMap(i => i.issues) };
    this.cached = { signature, archive };
    return archive;
  }
  async getEvent(id: string) { return (await this.getArchive()).events.find(event => event.id === id); }
  async findEvents(query: EventQuery) { return filterEvents((await this.getArchive()).events, query); }
}

export const eventRepository: EventRepository = new MarkdownEventRepository();

export async function readSource(category: string, year: string) {
  if (!categories.some(value => value === category) || !/^\d{1,4}$/.test(year)) return null;
  try { return await readFile(path.join(await realpath(archiveRoot()), category, `${year}.md`), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
