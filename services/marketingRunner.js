"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { objectives } = require("./marketingCatalog");
const python = "D:\\PanthoriumAI\\voice\\.venv\\Scripts\\python.exe";
class MarketingRunner {
  available() {
    return process.platform==="win32" && process.env.PANTHORIUM_DEPLOY_STAGE==="production" &&
      process.env.PANTHORIUM_DEPLOY_PROBE!=="1" && process.env.PANTHORIUM_LOCAL_PROFILE!=="1" &&
      fs.existsSync(python) && fs.existsSync("D:\\PanthoriumAI\\models\\Qwen3.5-2B-Q4_K_M.gguf") &&
      fs.existsSync("D:\\PanthoriumAI\\runtime\\llama-server.exe");
  }
  async generate(input) {
    if (!this.available() || this.child) throw Error("worker_unavailable");
    const env={PYTHONIOENCODING:"utf-8",PYTHONUTF8:"1",PYTHONDONTWRITEBYTECODE:"1"};
    for (const k of ["PATH","SystemRoot","WINDIR","TEMP","TMP","USERPROFILE","LOCALAPPDATA","PROGRAMFILES","ProgramData"])
      if (process.env[k]) env[k]=process.env[k];
    const child=spawn(python,["-u",path.join(__dirname,"../ops/marketing/qwen_worker.py")],{env,windowsHide:true,stdio:["pipe","pipe","ignore"]});
    this.child=child;
    try {
      const raw=await new Promise((resolve,reject)=>{
        let out="";
        const timeout=setTimeout(()=>child.kill(),145000);
        child.on("error",e=>{clearTimeout(timeout); reject(e);});
        child.stdout.setEncoding("utf8");
        child.stdout.on("data",s=>{out+=s;if (out.length>20000) child.kill();});
        child.on("close",code=>{clearTimeout(timeout); if (code!==0) reject(Error(code===75?"resource_pressure":"worker_failed")); else resolve(out);});
        child.stdin.on("error",()=>{}); child.stdin.end(JSON.stringify(input));
      });
      const result=JSON.parse(raw);
      if (!Object.hasOwn(objectives,result.objective) || !input.products.some(p=>p.id===result.product)) throw Error("invalid_model_draft");
      const brief={objective:result.objective,product:result.product};
      for (const k of ["audience","channel","experiment","searchQuery"]) {
        if (typeof result[k]!=="string" || !result[k].trim() || result[k].length>280) throw Error("invalid_model_draft");
        brief[k]=result[k].trim();
      }
      return brief;
    } finally { if (this.child===child) this.child=null; }
  }
  stop() { this.child?.kill(); }
}
module.exports={MarketingRunner};
