import * as readline from 'readline';
import * as fsp from 'fs/promises';
import * as path from 'path';

export function askQuestion(query: string, prefill: string = ""): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
    if (prefill) rl.write(prefill);
  });
}

export async function loadProjectContext(): Promise<string> {
  const cwd = process.cwd();
  const context: string[] = [];
  const files: string[] = await fsp.readdir(cwd).catch(() => []);

  if (files.includes('package.json')) {
    try {
      const content = await fsp.readFile(path.join(cwd, 'package.json'), 'utf-8');
      const pkg = JSON.parse(content);
      context.push(`[Node.js Project Detected]`);
      if (pkg.name) context.push(`- Name: ${pkg.name}`);
      if (pkg.scripts) context.push(`- Scripts: ${Object.keys(pkg.scripts).join(', ')}`);
      if (pkg.dependencies) context.push(`- Main Deps: ${Object.keys(pkg.dependencies).slice(0, 10).join(', ')}`);
    } catch {}
  }

  if (files.includes('requirements.txt')) {
    context.push(`[Python Project Detected]`);
  }
  
  if (files.includes('README.md')) {
     const content = await fsp.readFile(path.join(cwd, 'README.md'), 'utf-8');
     context.push(`[README Summary]: ${content.slice(0, 300).replace(/\n/g, ' ')}...`);
  }

  return context.length > 0 ? context.join('\n') : "No specific project configuration found.";
}