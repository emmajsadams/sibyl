import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

export function askMultiline(prompt: string): Promise<string> {
  console.log(`${prompt} (empty line to finish)`);
  return new Promise((resolve) => {
    const lines: string[] = [];
    const handler = (line: string) => {
      if (line === "") {
        rl.removeListener("line", handler);
        resolve(lines.join("\n"));
      } else {
        lines.push(line);
      }
    };
    rl.on("line", handler);
  });
}

export function close() {
  rl.close();
}
