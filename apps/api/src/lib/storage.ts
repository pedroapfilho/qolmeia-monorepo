import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "./env";

const client = new S3Client({
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
  endpoint: env.R2_ENDPOINT,
  region: env.R2_REGION,
});

const assetKey = (orgId: string, sha256: string, ext: string): string => {
  const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
  return `org_${orgId}/${sha256}.${cleanExt}`;
};

const fetchAsset = async (key: string): Promise<Uint8Array> => {
  const result = (await client.send(
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
  )) as { Body?: { transformToByteArray: () => Promise<Uint8Array> } };
  if (!result.Body) {
    throw new Error(`R2 fetch returned no body for key ${key}`);
  }
  return result.Body.transformToByteArray();
};

const uploadAsset = async (args: {
  bytes: Uint8Array;
  key: string;
  mimeType: string;
}): Promise<void> => {
  await client.send(
    new PutObjectCommand({
      Body: args.bytes,
      Bucket: env.R2_BUCKET,
      ContentType: args.mimeType,
      Key: args.key,
    }),
  );
};

export { assetKey, fetchAsset, uploadAsset };
