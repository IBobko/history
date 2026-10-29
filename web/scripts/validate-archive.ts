import { eventRepository } from "../src/lib/repository";

const archive = await eventRepository.getArchive();
// A misplaced source year is a warning; incomplete/unreadable imports block publication.
const fatal = archive.issues.filter(issue => issue.code !== "year_mismatch");
for (const issue of archive.issues) {
  console[issue.code === "year_mismatch" ? "warn" : "error"](`${issue.source}:${issue.line}: ${issue.message}`);
}
if (!archive.events.length || fatal.length) process.exitCode = 1;
console.log(`Archive: ${archive.files} files, ${archive.events.length} records, ${fatal.length} blocking issues.`);
