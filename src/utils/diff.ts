import * as fs from 'fs';
import * as path from 'path';
import * as diff from 'diff';
import { clr } from './formatting';

export function showDiff(filePath: string, newContent: string) {
  const target = path.resolve(process.cwd(), filePath);
  
  if (!fs.existsSync(target)) {
    console.log(clr.green + `\n+++ Creating NEW file: ${filePath}` + clr.reset);
    const lines = newContent.split('\n');
    console.log(lines.slice(0, 10).join('\n') + (lines.length > 10 ? `\n...` : ''));
    return;
  }

  const oldContent = fs.readFileSync(target, 'utf-8');
  const changes = diff.diffLines(oldContent, newContent);
  let hasChanges = false;

  console.log(clr.yellow + `\n📝 Proposed Changes for: ${filePath}` + clr.reset);
  console.log(clr.dim + '--------------------------------------' + clr.reset);
  
  changes.forEach(part => {
    if (part.added || part.removed) {
        hasChanges = true;
        const color = part.added ? clr.green : clr.red;
        const prefix = part.added ? '+ ' : '- ';
        process.stdout.write(color + part.value.replace(/^/gm, prefix) + clr.reset);
    }
  });

  if (!hasChanges) console.log(clr.dim + "No actual changes detected." + clr.reset);
  console.log(clr.dim + '--------------------------------------\n' + clr.reset);
}