// ./db.js
const postgres = require('postgres');
const axios = require('axios');

const nodes = [
  process.env.PGHOST,
  process.env.PGHOST2,
  process.env.PGHOST3,
];

let sqlClient = postgres({
  idle_timeout: 10,
  max_lifetime: 20,
  ssl: {
    rejectUnauthorized: false
  }
});

//proxy
/** @type {import('postgres').Sql} */
const sql = new Proxy(() => {}, {
  apply(_target, thisArg, args) {
    return sqlClient(...args); // tagged template
  },
  get(_target, prop) {
    return sqlClient[prop]; // e.g., sql.begin, sql.end, etc.
  }
});

//pings each node to get the leader, and updates the leader if changed
let currentIndex = 0;
setInterval(async () => {
  const nodeIP = nodes[currentIndex];
  
  try {
    const res = await axios.get(`http://${nodeIP}:8008/cluster`);
    const members = res.data.members;
    const leader = (members.find(m => m.role === 'leader')).host;
    const current = sqlClient.options.host[0];
    
    if (leader && leader !== current) {
      console.warn(`[db] Detected new leader: ${leader}, Rebuilding client...`);
      
      sqlClient = postgres({
        host: leader,
        idle_timeout: 10,
        max_lifetime: 20,
        ssl: {
          rejectUnauthorized: false
        }
      });
    }
  } catch (err) {
    console.error(`[db] Error pinging node ${nodeIP}: ${err.message}`);
  }
  
  currentIndex++;
  if (currentIndex >= nodes.length) {
    currentIndex = 0;
  }
}, 5000);

module.exports = sql;

