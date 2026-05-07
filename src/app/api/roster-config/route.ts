import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

function readEnvLocal(): Record<string, string> {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    const content = fs.readFileSync(envPath, 'utf8');
    const vars: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        vars[key] = val;
      }
    }
    return vars;
  } catch {
    return {};
  }
}

export async function GET() {
  const anthropicKey =
    process.env.ANTHROPIC_API_KEY ||
    readEnvLocal()['ANTHROPIC_API_KEY'] ||
    '';

  return NextResponse.json({ anthropicKey });
}
