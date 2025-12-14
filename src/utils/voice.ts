import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore
import * as recorder from 'node-record-lpcm16';
import Groq from 'groq-sdk';
import { ENV } from '../config/env';
import { clr } from './formatting';

const groq = new Groq({ apiKey: ENV.GROQ_API_KEY });

export async function captureVoice(): Promise<string> {
  return new Promise((resolve, reject) => {
    const filePath = path.join(process.cwd(), 'temp_voice_input.wav');
    const fileStream = fs.createWriteStream(filePath, { encoding: 'binary' });

    console.log(`\n${clr.red}🎙️  Recording... Press CTRL+C to stop.${clr.reset}`);

    const recording = recorder.record({
      sampleRate: 16000, threshold: 0, verbose: false, recordProgram: 'rec', silence: '10.0',
    });

    recording.stream().pipe(fileStream);

    const cleanup = () => {
      process.stdin.removeListener('keypress', handleKey);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      recording.stop(); 
    };

    const handleKey = (str: string, key: any) => {
      if (key && key.ctrl && key.name === 'c') {
        cleanup();
        console.log(`${clr.yellow}⏳ Transcribing...${clr.reset}`);
        
        setTimeout(async () => {
             try {
                const transcription = await groq.audio.transcriptions.create({
                  file: fs.createReadStream(filePath),
                  model: ENV.AUDIO_MODEL,
                  response_format: "text"
                });
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                resolve(transcription.toString().trim());
             } catch (error) {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                reject(error);
             }
        }, 1000); 
      }
    };

    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('keypress', handleKey);
    }
  });
}