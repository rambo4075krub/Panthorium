const fs = require("fs");
const path = require("path");

class AuditService {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  record(event, fields = {}) {
    const entry = {
      time: new Date().toISOString(),
      event,
      ...fields
    };
    fs.appendFile(this.file, JSON.stringify(entry) + "\n", () => {});
  }
}

module.exports = { AuditService };
