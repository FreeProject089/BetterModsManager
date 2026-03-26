import { ESLint } from "eslint";

(async function main() {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(["js/**/*.js"]);
  for (const result of results) {
    for (const msg of result.messages) {
      if (msg.ruleId === "no-unused-vars") {
         console.log(`${result.filePath.split('\\\\').pop()}:${msg.line} ${msg.message}`);
      }
    }
  }
})().catch((error) => console.error(error));
