import { AssistantHeaders } from '../types';

export async function transcribeAudio(
  baseUrl: string,
  headers: AssistantHeaders,
  wavBlob: Blob,
  signal?: AbortSignal
): Promise<string> {
  const form = new FormData();
  form.append('audio', wavBlob, 'speech.wav');
  const res = await fetch(`${baseUrl}voice/transcribe/`, {
    method: 'POST',
    headers: headers(),
    body: form,
    signal
  });
  if (!res.ok) throw new Error(`transcribe ${res.status}`);
  const json = (await res.json()) as { text?: string };
  return (json.text || '').trim();
}

export async function fetchSpeechStream(
  baseUrl: string,
  headers: AssistantHeaders,
  text: string,
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${baseUrl}voice/speech/`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal
  });
  if (!res.ok || !res.body) throw new Error(`speech ${res.status}`);
  return res.body;
}
