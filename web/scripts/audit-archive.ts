import { mkdir, writeFile } from "node:fs/promises";
import { eventRepository } from "../src/lib/repository";

const archive = await eventRepository.getArchive();
const report = { files: archive.files, dateBlocks: archive.dateBlocks, events: archive.events.length, legacyEvents: archive.events.filter(e => e.source.legacy).length, unknownDates: archive.events.filter(e => !e.date.earliest).length, issues: archive.issues };
await mkdir("reports", { recursive: true });
await writeFile("reports/import.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
