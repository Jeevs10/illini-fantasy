import { appIcon } from "./ui/appicon.tsx";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** What an iPhone puts on the home screen. */
export default function AppleIcon() {
  return appIcon(180);
}
