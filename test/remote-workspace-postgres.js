'use strict';
const {Pool}=require('pg');
const {run}=require('./remote-workspace');
(async()=>{if(!process.env.TEST_DATABASE_URL)throw Error('TEST_DATABASE_URL is required');const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});try{await run({pool});}finally{await pool.end();}})().catch(error=>{console.error(error);process.exitCode=1;});
