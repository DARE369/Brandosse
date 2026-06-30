import type { DatabaseClient } from "./supabase.ts";

const DEFAULT_BUCKET_LIMIT = 1024 * 1024 * 100; // 100MB

export async function ensureBucketExists(
  supabaseAdmin: DatabaseClient,
  bucketName: string,
  isPublic = true,
): Promise<void> {
  const { data, error } = await supabaseAdmin.storage.getBucket(bucketName);

  if (!error && data) {
    return;
  }

  const { error: createError } = await supabaseAdmin.storage.createBucket(bucketName, {
    public: isPublic,
    fileSizeLimit: DEFAULT_BUCKET_LIMIT,
  });

  if (createError && !String(createError.message).toLowerCase().includes("already exists")) {
    throw new Error(`Unable to create bucket "${bucketName}": ${createError.message}`);
  }
}

function extensionFromContentType(contentType: string | null | undefined): string {
  if (!contentType) return "bin";
  const normalized = contentType.toLowerCase();
  if (normalized.includes("image/jpeg")) return "jpg";
  if (normalized.includes("image/png")) return "png";
  if (normalized.includes("image/webp")) return "webp";
  if (normalized.includes("image/gif")) return "gif";
  if (normalized.includes("video/mp4")) return "mp4";
  if (normalized.includes("video/webm")) return "webm";
  return "bin";
}

function extensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const matched = pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    return matched?.[1]?.toLowerCase() ?? "bin";
  } catch (_err) {
    return "bin";
  }
}

export function buildGeneratedAssetPath(
  userId: string,
  folder: "images" | "videos",
  sourceUrl: string,
  contentType?: string | null,
): string {
  const extension = extensionFromContentType(contentType) || extensionFromUrl(sourceUrl) || "bin";
  const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
  return `${userId}/${folder}/${filename}`;
}

export async function uploadFromRemoteUrl(args: {
  supabaseAdmin: DatabaseClient;
  bucket: string;
  objectPath: string;
  sourceUrl: string;
  fallbackContentType: string;
}): Promise<{ publicUrl: string; storagePath: string; contentType: string }> {
  const { supabaseAdmin, bucket, objectPath, sourceUrl, fallbackContentType } = args;

  const sourceResponse = await fetch(sourceUrl);
  if (!sourceResponse.ok) {
    throw new Error(`Failed downloading provider asset (${sourceResponse.status})`);
  }

  const contentType = sourceResponse.headers.get("content-type") || fallbackContentType;
  const fileBytes = new Uint8Array(await sourceResponse.arrayBuffer());

  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(objectPath, fileBytes, {
      contentType,
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(objectPath);

  return {
    publicUrl: data.publicUrl,
    storagePath: objectPath,
    contentType,
  };
}
