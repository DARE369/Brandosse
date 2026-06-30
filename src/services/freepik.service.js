import { supabase } from './supabaseClient';

const ASPECT_DIMENSIONS = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '4:5': { width: 1024, height: 1280 },
};

function cleanPrompt(prompt) {
  return String(prompt || '').trim();
}

async function parseFunctionErrorContext(error) {
  try {
    const context = error?.context;
    if (!context) return null;

    if (typeof context.json === 'function') {
      const body = await context.json();
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
      return JSON.stringify(body);
    }

    if (typeof context.text === 'function') {
      const text = await context.text();
      if (!text) return null;
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error) return String(parsed.error);
        if (parsed?.message) return String(parsed.message);
      } catch (_err) {
        // Non-JSON error text.
      }
      return text;
    }
  } catch (_err) {
    // Ignore parsing failures and return fallback below.
  }

  return null;
}

async function toInvokeError(error, fallback = 'Edge Function request failed') {
  if (!error) return new Error(fallback);

  const detailed = await parseFunctionErrorContext(error);
  if (detailed) return new Error(detailed);

  if (error instanceof Error && error.message?.trim()) return new Error(error.message);
  if (typeof error.message === 'string' && error.message.trim()) return new Error(error.message);
  return new Error(fallback);
}

function getDimensions(aspectRatio = '1:1') {
  return ASPECT_DIMENSIONS[aspectRatio] || ASPECT_DIMENSIONS['1:1'];
}

async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw await toInvokeError(error, `${name} failed`);
  return data;
}

export async function generateImages({
  prompt,
  aspectRatio = '1:1',
  numImages = 1,
  brandKit = null,
  onProgress,
}) {
  const cleanedPrompt = cleanPrompt(prompt);
  if (!cleanedPrompt) {
    throw new Error('Prompt is required for image generation');
  }

  const count = Math.max(1, Math.min(Number(numImages) || 1, 4));
  const dimensions = getDimensions(aspectRatio);
  const images = [];

  for (let index = 0; index < count; index += 1) {
    const data = await invokeFunction('generateImage', {
      prompt: cleanedPrompt,
      brandKit,
      aspectRatio,
    });

    images.push({
      url: data.publicUrl,
      width: dimensions.width,
      height: dimensions.height,
      taskId: data.taskId,
      provider: data.provider || 'freepik',
    });

    if (typeof onProgress === 'function') {
      onProgress(Math.round(((index + 1) / count) * 100));
    }
  }

  return images;
}

export async function editImage({
  prompt,
  sourceImageUrl,
  brandKit = null,
  aspectRatio = '1:1',
}) {
  const cleanedPrompt = cleanPrompt(prompt);
  const cleanedSource = cleanPrompt(sourceImageUrl);

  if (!cleanedPrompt) throw new Error('Edit instruction is required');
  if (!cleanedSource) throw new Error('Source image is required');

  const data = await invokeFunction('editImage', {
    prompt: cleanedPrompt,
    sourceImageUrl: cleanedSource,
    brandKit,
    aspectRatio,
  });

  const dimensions = getDimensions(aspectRatio);
  return {
    url: data.publicUrl,
    width: dimensions.width,
    height: dimensions.height,
    taskId: data.taskId,
    provider: data.provider || 'freepik',
  };
}

export async function createVideoJob({
  prompt,
  aspectRatio = '16:9',
  duration = 5,
  brandKit = null,
}) {
  const cleanedPrompt = cleanPrompt(prompt);
  if (!cleanedPrompt) throw new Error('Prompt is required for video generation');

  const data = await invokeFunction('generateVideo', {
    prompt: cleanedPrompt,
    brandKit,
    aspectRatio,
    duration,
  });

  return {
    jobId: data.jobId,
    status: data.status || 'processing',
    provider: data.provider || 'freepik',
  };
}

export async function checkVideoJobStatus({ jobId, generationId }) {
  const cleanedJobId = cleanPrompt(jobId);
  if (!cleanedJobId) throw new Error('jobId is required');

  const data = await invokeFunction('videoStatus', {
    jobId: cleanedJobId,
    generationId: generationId || null,
  });

  return {
    status: data.status || 'processing',
    progress: typeof data.progress === 'number' ? data.progress : 0,
    videoUrl: data.videoUrl || null,
    error: data.error || null,
  };
}
