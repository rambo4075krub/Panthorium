const fs = require("fs");
const path = require("path");

class JsonStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) {
      this.write({ users: [], refreshTokens: [] });
    }
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return { users: [], refreshTokens: [] };
    }
  }

  write(data) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  update(mutator) {
    const data = this.read();
    const result = mutator(data) || data;
    this.write(result);
    return result;
  }
}

module.exports = { JsonStore };
