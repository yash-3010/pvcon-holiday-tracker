import { config } from "@/server/config";
import type { PayslipEnv } from "./payslips";

/** Upload directory, public URL and signing certificate from the environment. */
export function payslipEnv({ sign = true }: { sign?: boolean } = {}): PayslipEnv {
  return { uploadDir: config.uploadDir, appUrl: config.appUrl, signing: sign ? config.payslipSigning : null };
}
