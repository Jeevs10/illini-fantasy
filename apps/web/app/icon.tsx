import { appIcon } from "./ui/appicon.tsx";

export const contentType = "image/png";

/** The favicon and the manifest's two Android sizes, at /icon/192 and /icon/512. */
export function generateImageMetadata() {
  return [192, 512].map((size) => ({ id: String(size), size: { width: size, height: size }, contentType }));
}

export default async function Icon({ id }: { id: Promise<string> | string }) {
  return appIcon(Number(await id));
}
