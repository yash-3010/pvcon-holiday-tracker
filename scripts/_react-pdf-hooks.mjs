// Lets tsx scripts render payslip PDFs. Some @react-pdf packages only export an "import" condition, and tsx loads
// the app's TypeScript as CommonJS, so their `require` fails. This resolves @react-pdf/* with "import" added.
// Used by `npm run db:demo` as `tsx --import ./scripts/_react-pdf-hooks.mjs`.
import { registerHooks } from "node:module";

if (typeof registerHooks !== "function") {
  console.error(`This script needs Node.js 22.15 or newer (you have ${process.version}).`);
  process.exit(1);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@react-pdf/") && !context.conditions.includes("import")) {
      return nextResolve(specifier, { ...context, conditions: [...context.conditions, "import"] });
    }
    return nextResolve(specifier, context);
  },
});
