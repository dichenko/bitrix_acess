export const env = (k: string, d?: string) => {
  const v = process.env[`APP_${k}`] ?? process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env: ${k}`);
  return v!;
};
