const REQUIRED_MAJOR = 22;
const currentVersion = process.versions.node;
const currentMajor = Number.parseInt(currentVersion.split(".")[0] || "", 10);

if (currentMajor !== REQUIRED_MAJOR) {
  console.error(
    [
      `Atria requires Node ${REQUIRED_MAJOR}.x for stable Next.js and Expo builds.`,
      `Current runtime: ${currentVersion}`,
      "Node 25 reproduces .next trace/manifest ENOENT failures in this repo.",
      "",
      "Use the Homebrew LTS runtime for this project:",
      '  export PATH="$(brew --prefix node@22)/bin:$PATH"',
      "",
      "If you use nvm/fnm/Volta, switch this repo to Node 22 before continuing.",
    ].join("\n"),
  );
  process.exit(1);
}
